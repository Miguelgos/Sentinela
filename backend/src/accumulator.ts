import { seqHttpGet } from "./seq";
import { SeqApiEvent, parseSeqApiEvent } from "./types";

export type ParsedEvent = ReturnType<typeof parseSeqApiEvent>;

// O store mantém apenas o subset de raw_data que efetivamente é lido pelos
// consumidores (Properties via prop()), descartando MessageTemplateTokens,
// Links, EventType, Exception bruta etc. Reduz ~19KB → ~4KB por evento e
// permite 100k em store dentro do limit 768Mi do pod.
type CompactRaw = { Properties: SeqApiEvent["Properties"] };
export type StoredEvent = Omit<ParsedEvent, "raw_data"> & { raw_data: CompactRaw };

function compactEvent(p: ParsedEvent): StoredEvent {
  const raw = p.raw_data as SeqApiEvent;
  return {
    ...p,
    raw_data: { Properties: raw.Properties ?? [] },
  };
}

const LEVEL_FILTER = "@Level in ['Warning', 'Error', 'Fatal']";

const NOISE_SOURCES = new Set([
  "IdentityServer4.AccessTokenValidation.IdentityServerAuthenticationHandler",
  "Microsoft.AspNetCore.HttpOverrides.ForwardedHeadersMiddleware",
  "System.Net.Http.HttpClient.Default.LogicalHandler",
  "System.Net.Http.HttpClient.Default.ClientHandler",
  "Microsoft.AspNetCore.Routing.EndpointMiddleware",
  "Microsoft.AspNetCore.Routing.EndpointRoutingMiddleware",
  "Microsoft.AspNetCore.Hosting.Diagnostics",
]);

export function shouldStore(e: ParsedEvent): boolean {
  if (e.level === "Error" || e.level === "Critical") return true;
  if (e.source_context && NOISE_SOURCES.has(e.source_context)) return false;
  return true;
}

const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 86_400_000;

// Com store compacto (~4KB/evento), 100k cabem em ~400MB — bem dentro do
// limit 768Mi. Volume atual: ~65k eventos/7d, então 100k dá margem ~50%
// para crescimento.
const MAX_EVENTS = 100_000;

const _store = new Map<string, StoredEvent>();
let _latestSeqId: string | undefined;
let _oldestTs: string | undefined;
let _newestTs: string | undefined;

export type SyncPhase = "idle" | "syncing" | "done" | "error";
const _syncProgress: {
  phase: SyncPhase;
  daysDone: number;
  daysTotal: number;
  loaded: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
} = {
  phase: "idle",
  daysDone: 0,
  daysTotal: RETENTION_DAYS,
  loaded: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

export function getEvents(): StoredEvent[] {
  return [..._store.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
export function isReady(): boolean { return _syncProgress.phase === "done"; }
export function storeSize(): number { return _store.size; }
export function storeCoverage() {
  return { oldest: _oldestTs, newest: _newestTs };
}
export function getSyncProgress() {
  return { ..._syncProgress };
}

function addToStore(events: ParsedEvent[]): void {
  for (const p of events) {
    if (!p.event_id) continue;
    _store.set(p.event_id, compactEvent(p));
    if (!_newestTs || p.timestamp > _newestTs) _newestTs = p.timestamp;
    if (!_oldestTs || p.timestamp < _oldestTs) _oldestTs = p.timestamp;
  }
}

// Drop events older than RETENTION_MS and recompute _oldestTs
function applyMapRetention(): void {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  let removed = 0;
  for (const [id, e] of _store) {
    if (e.timestamp < cutoff) {
      _store.delete(id);
      removed++;
    }
  }
  if (removed > 0) {
    _oldestTs = undefined;
    for (const e of _store.values()) {
      if (!_oldestTs || e.timestamp < _oldestTs) _oldestTs = e.timestamp;
    }
    console.log(`[accumulator] retenção: -${removed} eventos > ${RETENTION_DAYS}d (store: ${_store.size})`);
  }
}

// Hard cap: drop oldest until size <= MAX_EVENTS
function applyMaxEventsCap(): void {
  if (_store.size <= MAX_EVENTS) return;
  const entries = [..._store.entries()].sort((a, b) =>
    a[1].timestamp.localeCompare(b[1].timestamp),
  );
  const toRemove = entries.length - MAX_EVENTS;
  for (let i = 0; i < toRemove; i++) _store.delete(entries[i][0]);
  _oldestTs = entries[toRemove]?.[1].timestamp;
  console.log(`[accumulator] cap: -${toRemove} eventos (store: ${_store.size}, max: ${MAX_EVENTS})`);
}

// Fetch a window from Seq with from+to, paginated by afterId
async function fetchSeqRange(from: Date, to: Date, maxEvents = 50_000): Promise<ParsedEvent[]> {
  const PAGE = 1000;
  const SEQ_SIGNAL = process.env.SEQ_SIGNAL || "";
  const results: ParsedEvent[] = [];
  let afterId: string | undefined;

  while (results.length < maxEvents) {
    let qs = `?count=${PAGE}&render=true`;
    if (SEQ_SIGNAL) qs += `&signal=${encodeURIComponent(SEQ_SIGNAL)}`;
    qs += `&filter=${encodeURIComponent(LEVEL_FILTER)}`;
    qs += `&fromDateUtc=${encodeURIComponent(from.toISOString())}`;
    qs += `&toDateUtc=${encodeURIComponent(to.toISOString())}`;
    if (afterId) qs += `&afterId=${encodeURIComponent(afterId)}`;

    const raw: SeqApiEvent[] = await seqHttpGet(`/api/events/${qs}`);
    if (raw.length === 0) break;

    for (const e of raw) {
      const p = parseSeqApiEvent(e);
      if (shouldStore(p)) results.push(p);
    }

    if (raw.length < PAGE) break;
    afterId = raw[raw.length - 1]?.Id;
    if (!afterId) break;
  }

  return results;
}

// Poll a cada 60s: busca só o que é mais novo que _latestSeqId
async function refresh(): Promise<void> {
  const PAGE = 500;
  const SEQ_SIGNAL = process.env.SEQ_SIGNAL || "";
  let qs = `?count=${PAGE}&render=true`;
  if (SEQ_SIGNAL) qs += `&signal=${encodeURIComponent(SEQ_SIGNAL)}`;
  qs += `&filter=${encodeURIComponent(LEVEL_FILTER)}`;

  const raw: SeqApiEvent[] = await seqHttpGet(`/api/events/${qs}`);
  if (raw.length === 0) return;

  const batch: ParsedEvent[] = [];
  for (const e of raw) {
    if (_latestSeqId && e.Id === _latestSeqId) break;
    const p = parseSeqApiEvent(e);
    if (shouldStore(p)) batch.push(p);
  }

  if (batch.length > 0) {
    addToStore(batch);
    console.log(`[accumulator] +${batch.length} novos (store: ${_store.size})`);
  }

  if (raw[0]?.Id) _latestSeqId = raw[0].Id;

  applyMapRetention();
  applyMaxEventsCap();
}

// Sync 7 dias em chunks de 1 dia (do mais recente pro mais antigo).
// Atualiza _syncProgress a cada chunk pra dar feedback ao frontend.
async function syncFullHistory(): Promise<void> {
  _syncProgress.phase = "syncing";
  _syncProgress.startedAt = new Date().toISOString();
  _syncProgress.daysDone = 0;
  _syncProgress.loaded = 0;
  _syncProgress.error = null;

  console.log(`[accumulator] sync inicial: ${RETENTION_DAYS} dias em chunks de 1 dia`);

  for (let d = 1; d <= RETENTION_DAYS; d++) {
    const to = new Date(Date.now() - (d - 1) * 86_400_000);
    const from = new Date(Date.now() - d * 86_400_000);
    try {
      const events = await fetchSeqRange(from, to);
      if (events.length > 0) {
        addToStore(events);
        _syncProgress.loaded += events.length;
      }
      // Lembra o ID mais recente já visto pra base do refresh()
      if (d === 1 && events.length > 0 && !_latestSeqId) {
        // events vêm em ordem desc (mais recente primeiro); pega o mais novo
        const newest = events.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
        _latestSeqId = newest.event_id ?? undefined;
      }
      console.log(`[accumulator] dia ${d}/${RETENTION_DAYS}: +${events.length} eventos (store: ${_store.size})`);
    } catch (err) {
      console.error(`[accumulator] erro no dia ${d}:`, err);
    }
    _syncProgress.daysDone = d;
    applyMaxEventsCap();
  }

  _syncProgress.phase = "done";
  _syncProgress.finishedAt = new Date().toISOString();
  console.log(`[accumulator] sync completo: ${_syncProgress.loaded} eventos | store: ${_store.size}`);
}

// Boot não-bloqueante: HTTP server e refresh sobem imediatamente,
// sync de 7d roda em background. async pra compat com chamadores existentes.
export async function initAccumulator(): Promise<void> {
  setInterval(() => {
    refresh().catch((err) => console.error("[accumulator] erro no refresh:", err));
  }, 60_000);

  syncFullHistory().catch((err) => {
    _syncProgress.phase = "error";
    _syncProgress.error = String(err);
    console.error("[accumulator] erro no sync inicial:", err);
  });
}
