import { fetchSeq, ParsedEvent } from "./seq";
import { SeqApiEvent } from "./types";

// Store mantém apenas o subset de raw_data lido pelos consumidores (Properties
// via prop()), descartando MessageTemplateTokens, Links, EventType e Exception.
// Reduz ~19KB → ~4KB por evento e permite 100k em store dentro do limit 768Mi.
type CompactRaw = { Properties: SeqApiEvent["Properties"] };
export type StoredEvent = Omit<ParsedEvent, "raw_data"> & { raw_data: CompactRaw };

function compactEvent(p: ParsedEvent): StoredEvent {
  const raw = p.raw_data as SeqApiEvent;
  return { ...p, raw_data: { Properties: raw.Properties ?? [] } };
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
const MAX_EVENTS = 100_000;

const _store = new Map<string, StoredEvent>();
let _latestSeqId: string | undefined;
let _oldestTs: string | undefined;
let _newestTs: string | undefined;

// Cache do array sorted retornado por getEvents(). Invalidado em qualquer
// mutação do store. Sem cache, cada handler HTTP paga O(n log n) com n=100k.
let _sortedCache: StoredEvent[] | null = null;

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
  if (_sortedCache) return _sortedCache;
  _sortedCache = [..._store.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return _sortedCache;
}

export function getEventById(id: string): StoredEvent | undefined {
  return _store.get(id);
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
  if (events.length === 0) return;
  for (const p of events) {
    if (!p.event_id) continue;
    _store.set(p.event_id, compactEvent(p));
    if (!_newestTs || p.timestamp > _newestTs) _newestTs = p.timestamp;
    if (!_oldestTs || p.timestamp < _oldestTs) _oldestTs = p.timestamp;
  }
  _sortedCache = null;
}

function applyMapRetention(): void {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  if (_oldestTs && _oldestTs >= cutoff) return;

  let removed = 0;
  let nextOldest: string | undefined;
  for (const [id, e] of _store) {
    if (e.timestamp < cutoff) {
      _store.delete(id);
      removed++;
    } else if (!nextOldest || e.timestamp < nextOldest) {
      nextOldest = e.timestamp;
    }
  }
  if (removed > 0) {
    _oldestTs = nextOldest;
    _sortedCache = null;
    console.log(`[accumulator] retenção: -${removed} eventos > ${RETENTION_DAYS}d (store: ${_store.size})`);
  }
}

function applyMaxEventsCap(): void {
  if (_store.size <= MAX_EVENTS) return;
  const entries = [..._store.entries()].sort((a, b) =>
    a[1].timestamp.localeCompare(b[1].timestamp),
  );
  const toRemove = entries.length - MAX_EVENTS;
  for (let i = 0; i < toRemove; i++) _store.delete(entries[i][0]);
  _oldestTs = entries[toRemove]?.[1].timestamp;
  _sortedCache = null;
  console.log(`[accumulator] cap: -${toRemove} eventos (store: ${_store.size}, max: ${MAX_EVENTS})`);
}

async function refresh(): Promise<void> {
  const raw = await fetchSeq({
    signal: process.env.SEQ_SIGNAL,
    filter: LEVEL_FILTER,
    maxTotal: 500,
    predicate: shouldStore,
    stopAtId: _latestSeqId,
  });

  if (raw.length === 0) return;

  addToStore(raw);
  console.log(`[accumulator] +${raw.length} novos (store: ${_store.size})`);

  // raw vem em ordem desc (mais recente primeiro), mantido pelo Seq
  if (raw[0]?.event_id) _latestSeqId = raw[0].event_id;

  applyMapRetention();
  applyMaxEventsCap();
}

async function syncDay(d: number): Promise<ParsedEvent[]> {
  const to = new Date(Date.now() - (d - 1) * 86_400_000);
  const from = new Date(Date.now() - d * 86_400_000);
  try {
    const events = await fetchSeq({
      signal: process.env.SEQ_SIGNAL,
      filter: LEVEL_FILTER,
      fromDate: from,
      toDate: to,
      maxTotal: 50_000,
      predicate: shouldStore,
    });
    console.log(`[accumulator] dia ${d}/${RETENTION_DAYS}: +${events.length} eventos`);
    return events;
  } catch (err) {
    console.error(`[accumulator] erro no dia ${d}:`, err);
    return [];
  } finally {
    _syncProgress.daysDone++;
  }
}

async function syncFullHistory(): Promise<void> {
  _syncProgress.phase = "syncing";
  _syncProgress.startedAt = new Date().toISOString();
  _syncProgress.daysDone = 0;
  _syncProgress.loaded = 0;
  _syncProgress.error = null;

  console.log(`[accumulator] sync inicial: ${RETENTION_DAYS} dias em paralelo`);

  // Dias são independentes — paralelizar reduz cold-start ~7x. Limite de
  // concorrência implícito é o agente HTTP do Node (não há pool externo).
  const days = Array.from({ length: RETENTION_DAYS }, (_, i) => i + 1);
  const results = await Promise.all(days.map(syncDay));

  for (const events of results) addToStore(events);
  _syncProgress.loaded = results.reduce((s, ev) => s + ev.length, 0);

  // raw[0] do dia 1 é o evento mais recente (Seq retorna em ordem desc)
  if (!_latestSeqId && results[0]?.[0]?.event_id) {
    _latestSeqId = results[0][0].event_id;
  }

  applyMaxEventsCap();
  _syncProgress.phase = "done";
  _syncProgress.finishedAt = new Date().toISOString();
  console.log(`[accumulator] sync completo: ${_syncProgress.loaded} eventos | store: ${_store.size}`);
}

// Boot não-bloqueante: HTTP server e refresh sobem imediatamente, sync de 7d
// roda em background. async pra compat com chamadores existentes.
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
