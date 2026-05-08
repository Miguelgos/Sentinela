// Kong accumulator — eventos "Kong Auth Request" do Seq bucketizados em
// memória. Polling 60s + backfill 10d. Sem eventStore: o drill-down (topUsers,
// topIPs, recentFailures) continua sendo feito por fetchSeq live em
// getKongAuthStats, que cobre a retenção viva (~6h).
//
// Dimensões geradas (por evento):
//   kong_total       — todo Kong Auth Request
//   kong_ok          — StatusCode == 200
//   kong_fail        — StatusCode != 200
//   kong_fail_401    — StatusCode == 401
//   kong_fail_500    — StatusCode == 500

import { fetchSeq, ParsedEvent, prop } from "../seq";
import { BucketStore, tsToMinute } from "../timeseries/bucketStore";
import { REFERENCE_WINDOW_DAYS } from "../timeseries/types";

const KONG_FILTER = "@Message = 'Kong Auth Request'";

const _bucketStore = new BucketStore();
const KONG_SOURCE = "kong";

export const KONG = KONG_SOURCE;

let _latestSeqId: string | undefined;

let _syncPhase: "idle" | "syncing" | "done" | "error" = "idle";
let _syncError: string | null = null;
let _syncStartedAt: string | null = null;
let _syncFinishedAt: string | null = null;
let _eventsLoaded = 0;

export function dimensionsForKongEvent(e: ParsedEvent): Record<string, number> {
  const status = Number(prop(e, "StatusCode"));
  const out: Record<string, number> = { kong_total: 1 };
  if (status === 200) {
    out.kong_ok = 1;
  } else {
    out.kong_fail = 1;
    if (status === 401) out.kong_fail_401 = 1;
    if (status === 500) out.kong_fail_500 = 1;
  }
  return out;
}

function ingest(events: ParsedEvent[]): void {
  if (events.length === 0) return;

  const byMinute = new Map<number, Record<string, number>>();
  for (const e of events) {
    if (!e.event_id) continue;
    const minute = tsToMinute(e.timestamp);

    const dims = dimensionsForKongEvent(e);
    let acc = byMinute.get(minute);
    if (!acc) {
      acc = {};
      byMinute.set(minute, acc);
    }
    for (const [k, n] of Object.entries(dims)) acc[k] = (acc[k] ?? 0) + n;
  }

  for (const [minute, dims] of byMinute) {
    _bucketStore.bumpMany(KONG_SOURCE, minute, dims);
  }
}

async function refresh(): Promise<void> {
  const raw = await fetchSeq({
    filter: KONG_FILTER,
    maxTotal: 2000,
    stopAtId: _latestSeqId,
  });

  if (raw.length === 0) return;

  const nowMin = Math.floor(Date.now() / 60_000);
  ingest(raw);
  console.log(`[kongAccumulator] +${raw.length} novos`);

  if (raw[0]?.event_id) _latestSeqId = raw[0].event_id;

  _bucketStore.rotateTo(KONG_SOURCE, nowMin);
}

async function syncDay(d: number): Promise<ParsedEvent[]> {
  const to = new Date(Date.now() - (d - 1) * 86_400_000);
  const from = new Date(Date.now() - d * 86_400_000);
  try {
    const events = await fetchSeq({
      filter: KONG_FILTER,
      fromDate: from,
      toDate: to,
      maxTotal: 50_000,
    });
    console.log(`[kongAccumulator] dia ${d}/${REFERENCE_WINDOW_DAYS}: +${events.length} eventos`);
    return events;
  } catch (err) {
    console.error(`[kongAccumulator] erro no dia ${d}:`, err);
    return [];
  }
}

async function syncFullHistory(): Promise<void> {
  _syncPhase = "syncing";
  _syncStartedAt = new Date().toISOString();
  _syncError = null;
  _eventsLoaded = 0;

  console.log(`[kongAccumulator] sync inicial: ${REFERENCE_WINDOW_DAYS} dias`);

  const nowMin = Math.floor(Date.now() / 60_000);
  for (let d = 1; d <= REFERENCE_WINDOW_DAYS; d++) {
    const events = await syncDay(d);
    if (events.length > 0) {
      ingest(events);
      _eventsLoaded += events.length;

      if (d === 1 && !_latestSeqId && events[0]?.event_id) {
        _latestSeqId = events[0].event_id;
      }
    }
  }

  _bucketStore.rotateTo(KONG_SOURCE, nowMin);
  _syncPhase = "done";
  _syncFinishedAt = new Date().toISOString();
  const stats = _bucketStore.getStats(KONG_SOURCE);
  console.log(`[kongAccumulator] sync completo: ${_eventsLoaded} eventos | ${stats.dimensions} dims`);
}

export async function initKongAccumulator(): Promise<void> {
  setInterval(() => {
    refresh().catch(err => console.error("[kongAccumulator] erro refresh:", err));
  }, 60_000);

  syncFullHistory().catch(err => {
    _syncPhase = "error";
    _syncError = String(err);
    console.error("[kongAccumulator] erro no sync inicial:", err);
  });
}

// ── API pública ──────────────────────────────────────────────────────────────

export function getKongBucketStore(): BucketStore { return _bucketStore; }
export function isKongReady(): boolean { return _syncPhase === "done"; }
export function getKongSyncProgress() {
  return {
    phase: _syncPhase, error: _syncError,
    startedAt: _syncStartedAt, finishedAt: _syncFinishedAt, loaded: _eventsLoaded,
  };
}
