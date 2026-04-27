import { seqHttpGet } from "./seq";
import { SeqApiEvent, parseSeqApiEvent } from "./types";

export type ParsedEvent = ReturnType<typeof parseSeqApiEvent>;

// Só traz erros e alertas do SEQ — reduz volume drasticamente
const LEVEL_FILTER = "@Level in ['Warning', 'Error', 'Fatal']";

// ── Noise sources descartadas em níveis não-críticos ─────────────────────────
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

const RETENTION_MS = 7 * 86_400_000;

const _store = new Map<string, ParsedEvent>();
let _latestSeqId: string | undefined;
let _ready = false;
let _oldestTs: string | undefined;
let _newestTs: string | undefined;

export function getEvents(): ParsedEvent[] {
  return [..._store.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
export function isReady(): boolean { return _ready; }
export function storeSize(): number { return _store.size; }
export function storeCoverage() {
  return { oldest: _oldestTs, newest: _newestTs };
}

function addToStore(events: ParsedEvent[]): void {
  for (const p of events) {
    if (!p.event_id) continue;
    _store.set(p.event_id, p);
    if (!_newestTs || p.timestamp > _newestTs) _newestTs = p.timestamp;
    if (!_oldestTs || p.timestamp < _oldestTs) _oldestTs = p.timestamp;
  }
}

// ── Remove do Map eventos mais antigos que 7 dias e recalcula _oldestTs ───────
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
    // Recalcula _oldestTs após o trim
    _oldestTs = undefined;
    for (const e of _store.values()) {
      if (!_oldestTs || e.timestamp < _oldestTs) _oldestTs = e.timestamp;
    }
    console.log(`[accumulator] retenção: -${removed} eventos > 7d (store: ${_store.size})`);
  }
}

// ── Fetch paginado do Seq com fromDateUtc opcional ────────────────────────────
async function fetchFromSeq(sinceDate?: Date, maxEvents = 500_000): Promise<{ events: ParsedEvent[]; firstId?: string }> {
  const PAGE = 1000;
  const SEQ_SIGNAL = process.env.SEQ_SIGNAL || "";
  const results: ParsedEvent[] = [];
  let afterId: string | undefined;
  let firstId: string | undefined;

  while (results.length < maxEvents) {
    let qs = `?count=${PAGE}&render=true`;
    if (SEQ_SIGNAL)   qs += `&signal=${encodeURIComponent(SEQ_SIGNAL)}`;
    qs += `&filter=${encodeURIComponent(LEVEL_FILTER)}`;
    if (sinceDate)    qs += `&fromDateUtc=${encodeURIComponent(sinceDate.toISOString())}`;
    if (afterId)      qs += `&afterId=${encodeURIComponent(afterId)}`;

    const raw: SeqApiEvent[] = await seqHttpGet(`/api/events/${qs}`);
    if (raw.length === 0) break;

    if (!firstId && raw[0]?.Id) firstId = raw[0].Id;

    let done = false;
    for (const e of raw) {
      if (sinceDate && new Date(e.Timestamp) < sinceDate) { done = true; break; }
      const p = parseSeqApiEvent(e);
      if (shouldStore(p)) results.push(p);
    }

    if (done || raw.length < PAGE) break;
    afterId = raw[raw.length - 1]?.Id;
    if (!afterId) break;
  }

  return { events: results, firstId };
}

// ── Poll a cada 60s: busca só o que é mais novo que _latestSeqId ──────────────
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
}

// ── Inicialização ─────────────────────────────────────────────────────────────
export async function initAccumulator(): Promise<void> {
  try {
    // Full sync dos últimos 7 dias do Seq
    const sinceDate = new Date(Date.now() - RETENTION_MS);
    console.log(`[accumulator] full sync do Seq desde ${sinceDate.toISOString().slice(0, 10)}`);

    const { events: newEvents, firstId } = await fetchFromSeq(sinceDate, 50_000);

    if (newEvents.length > 0) {
      addToStore(newEvents);
      console.log(`[accumulator] Seq sync: ${newEvents.length} eventos carregados`);
    } else {
      console.log("[accumulator] Seq sync concluído — nenhum evento no período");
    }

    if (firstId) _latestSeqId = firstId;

  } catch (err) {
    console.error("[accumulator] erro na inicialização:", err);
  } finally {
    _ready = true;
    console.log(`[accumulator] pronto — store: ${_store.size} | desde: ${_oldestTs?.slice(0, 10) ?? "?"}`);
  }

  setInterval(async () => {
    try { await refresh(); }
    catch (err) { console.error("[accumulator] erro no refresh:", err); }
  }, 60_000);
}
