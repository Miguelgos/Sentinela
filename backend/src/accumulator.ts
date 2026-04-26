import { seqHttpGet } from "./seq";
import { SeqApiEvent, parseSeqApiEvent } from "./types";
import { bulkInsert, loadAll, countEvents, oldestTimestamp, applyRetention, shouldStore } from "./db/sqlite";

export type ParsedEvent = ReturnType<typeof parseSeqApiEvent>;

const _store = new Map<string, ParsedEvent>();
let _latestSeqId: string | undefined; // Seq-internal Id do evento mais recente visto
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

// ── Fetch paginado do Seq com fromDateUtc opcional ────────────────────────────
async function fetchFromSeq(sinceDate?: Date, maxEvents = 500_000): Promise<{ events: ParsedEvent[]; firstId?: string }> {
  const PAGE = 1000;
  const SEQ_SIGNAL = process.env.SEQ_SIGNAL || "";
  const results: ParsedEvent[] = [];
  let afterId: string | undefined;
  let firstId: string | undefined; // Id do evento mais recente (primeira página)

  while (results.length < maxEvents) {
    let qs = `?count=${PAGE}&render=true`;
    if (SEQ_SIGNAL) qs += `&signal=${encodeURIComponent(SEQ_SIGNAL)}`;
    if (sinceDate)  qs += `&fromDateUtc=${encodeURIComponent(sinceDate.toISOString())}`;
    if (afterId)    qs += `&afterId=${encodeURIComponent(afterId)}`;

    const raw: SeqApiEvent[] = await seqHttpGet(`/api/events/${qs}`);
    if (raw.length === 0) break;

    // Captura o Id Seq do evento mais novo (só na primeira página)
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
    const inserted = bulkInsert(batch);
    console.log(`[accumulator] +${batch.length} filtrados, ${inserted} novos no DB (store: ${_store.size})`);
  }

  if (raw[0]?.Id) _latestSeqId = raw[0].Id;
}

// ── Inicialização ─────────────────────────────────────────────────────────────
export async function initAccumulator(): Promise<void> {
  try {
    // 0. Retenção: remove eventos expirados antes de carregar
    const { deletedA, deletedB } = applyRetention();
    if (deletedA + deletedB > 0)
      console.log(`[accumulator] retenção: -${deletedB} tier-B (>7d), -${deletedA} tier-A (>90d)`);

    // 1. Carrega do SQLite (síncrono, imediato)
    const sqliteEvents = loadAll();
    addToStore(sqliteEvents);
    if (sqliteEvents.length > 0) {
      console.log(`[accumulator] SQLite: ${sqliteEvents.length} eventos (desde ${_oldestTs?.slice(0, 10)})`);
    } else {
      console.log("[accumulator] SQLite vazio — full sync do Seq");
    }

    // 2. Sync do Seq — só o que é mais novo que o que já temos
    // Subtrai 1 min do _newestTs para garantir overlap e não perder eventos
    const sinceDate = _newestTs
      ? new Date(new Date(_newestTs).getTime() - 60_000)
      : undefined;

    const { events: newEvents, firstId } = await fetchFromSeq(sinceDate);

    if (newEvents.length > 0) {
      addToStore(newEvents);
      const inserted = bulkInsert(newEvents);
      console.log(`[accumulator] Seq sync: ${newEvents.length} eventos, ${inserted} novos persistidos`);
    }

    // Guarda o Seq Id mais recente para os polls futuros
    if (firstId) _latestSeqId = firstId;

  } catch (err) {
    console.error("[accumulator] erro na inicialização:", err);
  } finally {
    _ready = true;
    const dbTotal  = countEvents();
    const dbOldest = oldestTimestamp();
    console.log(`[accumulator] pronto — store: ${_store.size} | DB: ${dbTotal} | desde: ${dbOldest?.slice(0, 10) ?? "?"}`);
  }

  setInterval(async () => {
    try { await refresh(); }
    catch (err) { console.error("[accumulator] erro no refresh:", err); }
  }, 60_000);
}
