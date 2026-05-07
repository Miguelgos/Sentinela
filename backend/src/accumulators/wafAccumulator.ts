// WAF accumulator — eventos GoCache (WAF + Bot + Firewall) bucketizados em
// memória. Polling 60s + backfill 10d.
//
// Dimensões geradas:
//   total                    — todos eventos (qualquer tipo)
//   type:waf | bot | firewall
//   attack:SQLi | XSS | PathTraversal | Scanner | Protocol | Other
//   country:{cc}             — cap top-50 por volume
//   tool:SQLMap | Nikto | Dart | Python | curl | Go | Java | Headless | Browser/Other
//   blocked                  — eventos com action=block

import { gcFetch } from "../lib/gcClient";
import { BucketStore } from "../timeseries/bucketStore";
import { EventStore } from "../timeseries/eventStore";
import { REFERENCE_WINDOW_DAYS, EVENT_STORE_WINDOW_MIN } from "../timeseries/types";

interface GcAlert { id: string; msg: string; match?: string }
export interface GcEvent {
  ip: string;
  uri: string;
  user_agent?: string;
  country_code?: string;
  type?: "waf" | "bot-mitigation" | "firewall";
  action?: string;
  alerts?: GcAlert[];
  timestamp?: number; // segundos epoch (campo timestamp do GoCache)
  date?: string;      // alguns endpoints retornam ISO
}

const _bucketStore = new BucketStore();
const _eventStore = new EventStore<GcEvent>();
const WAF_SOURCE = "waf";

export const WAF = WAF_SOURCE;

let _syncPhase: "idle" | "syncing" | "done" | "error" = "idle";
let _syncError: string | null = null;
let _syncStartedAt: string | null = null;
let _syncFinishedAt: string | null = null;
let _eventsLoaded = 0;

function classifyAlert(msg: string, id: string): string {
  const m = (msg ?? "").toLowerCase();
  const i = id ?? "";
  if (m.includes("sql") || m.includes("injection") || /^94[0-9]/.test(i) || /^93[0-9]/.test(i)) return "SQLi";
  if (m.includes("xss") || m.includes("script") || /^941/.test(i)) return "XSS";
  if (m.includes("traversal") || m.includes("path") || /^930/.test(i)) return "PathTraversal";
  if (m.includes("scan") || m.includes("nikto") || m.includes("nmap")) return "Scanner";
  if (m.includes("protocol") || /^92[0-9]/.test(i)) return "Protocol";
  return "Other";
}

function detectTool(ua: string): string {
  if (!ua) return "Unknown";
  const u = ua.toLowerCase();
  if (u.includes("sqlmap"))  return "SQLMap";
  if (u.includes("nikto"))   return "Nikto";
  if (u.includes("dart"))    return "Dart";
  if (u.includes("python"))  return "Python";
  if (u.includes("curl"))    return "curl";
  if (u.includes("go-http")) return "Go";
  if (u.includes("java") && !u.includes("javascript")) return "Java";
  if (u.includes("headlesschrome") || u.includes("phantomjs")) return "Headless";
  return "Browser/Other";
}

function eventTimestamp(e: GcEvent): number | null {
  if (typeof e.timestamp === "number") return e.timestamp * 1000;
  if (e.date) {
    const t = Date.parse(e.date);
    return isNaN(t) ? null : t;
  }
  return null;
}

function eventId(e: GcEvent, ts: number): string {
  // GoCache não tem ID estável — usa hash determinístico de IP + URI + timestamp.
  return `${e.ip}|${e.uri}|${ts}`;
}

export function dimensionsForGcEvent(e: GcEvent): Record<string, number> {
  const out: Record<string, number> = { total: 1 };
  if (e.type === "waf")            out["type:waf"] = 1;
  if (e.type === "bot-mitigation") out["type:bot"] = 1;
  if (e.type === "firewall")       out["type:firewall"] = 1;

  // Cada alerta dentro de um evento pode classificar em múltiplos vetores.
  // Usa a primeira classificação ≠ "Other" (mais específica), senão "Other".
  let attackKey = "attack:Other";
  for (const a of e.alerts ?? []) {
    const cat = classifyAlert(a.msg, a.id);
    if (cat !== "Other") { attackKey = `attack:${cat}`; break; }
  }
  out[attackKey] = 1;

  if (e.country_code) out[`country:${e.country_code}`] = 1;
  out[`tool:${detectTool(e.user_agent ?? "")}`] = 1;
  if (e.action === "block") out.blocked = 1;
  return out;
}

function ingest(events: GcEvent[], nowMin: number): void {
  if (events.length === 0) return;
  const byMinute = new Map<number, Record<string, number>>();
  const eventBatch: { eventId: string; event: GcEvent; timestamp: number }[] = [];

  for (const e of events) {
    const tsMs = eventTimestamp(e);
    if (tsMs === null) continue;
    const minute = Math.floor(tsMs / 60_000);

    const dims = dimensionsForGcEvent(e);
    let acc = byMinute.get(minute);
    if (!acc) {
      acc = {};
      byMinute.set(minute, acc);
    }
    for (const [k, n] of Object.entries(dims)) acc[k] = (acc[k] ?? 0) + n;

    if (minute >= nowMin - EVENT_STORE_WINDOW_MIN) {
      eventBatch.push({ eventId: eventId(e, tsMs), event: e, timestamp: minute });
    }
  }

  for (const [minute, dims] of byMinute) {
    _bucketStore.bumpMany(WAF_SOURCE, minute, dims);
  }
  _eventStore.putMany(WAF_SOURCE, eventBatch);
}

const TYPES: GcEvent["type"][] = ["waf", "bot-mitigation", "firewall"];

interface FetchOpts {
  start_date: number;
  end_date: number;
  type: GcEvent["type"][];
  action: string[];
  limit: number;
}

async function fetchGc(opts: FetchOpts): Promise<GcEvent[]> {
  const result = await gcFetch("/v1/threat-hub/events", "POST", opts) as Record<string, unknown>;
  const events = ((result?.response as Record<string, unknown>)?.events ?? []) as GcEvent[];
  return events;
}

async function fetchRange(fromSec: number, toSec: number): Promise<GcEvent[]> {
  // Faz 1 chamada por type — limit de 200 por chamada.
  const all: GcEvent[] = [];
  for (const type of TYPES) {
    if (!type) continue;
    try {
      const evs = await fetchGc({
        start_date: fromSec,
        end_date: toSec,
        type: [type],
        action: ["block"],
        limit: 200,
      });
      // anota o type pra dimensionsForGcEvent
      for (const e of evs) e.type = type;
      all.push(...evs);
    } catch (err) {
      console.error(`[wafAccumulator] erro fetch ${type}:`, err);
    }
  }
  return all;
}

async function refresh(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 120; // últimos 2 min — overlap pra não perder eventos no border
  const events = await fetchRange(from, now);
  if (events.length === 0) return;

  const nowMin = Math.floor(Date.now() / 60_000);
  ingest(events, nowMin);
  _bucketStore.rotateTo(WAF_SOURCE, nowMin);
  _eventStore.pruneToWindow(WAF_SOURCE, nowMin);
  console.log(`[wafAccumulator] +${events.length} eventos (eventStore: ${_eventStore.size(WAF_SOURCE)})`);
}

async function syncFullHistory(): Promise<void> {
  _syncPhase = "syncing";
  _syncStartedAt = new Date().toISOString();
  _syncError = null;
  _eventsLoaded = 0;

  console.log(`[wafAccumulator] sync inicial: ${REFERENCE_WINDOW_DAYS} dias`);
  const nowMin = Math.floor(Date.now() / 60_000);

  // Backfill dia-a-dia (limit de 200 events por chamada × 3 types ⇒ até 600 eventos por dia).
  // Volume real provavelmente <100 events/dia, então 1 chamada por dia é suficiente.
  for (let d = REFERENCE_WINDOW_DAYS; d >= 1; d--) {
    const toSec   = Math.floor(Date.now() / 1000) - (d - 1) * 86400;
    const fromSec = Math.floor(Date.now() / 1000) - d * 86400;
    const events = await fetchRange(fromSec, toSec);
    if (events.length > 0) {
      ingest(events, nowMin);
      _eventsLoaded += events.length;
    }
    console.log(`[wafAccumulator] dia ${REFERENCE_WINDOW_DAYS - d + 1}/${REFERENCE_WINDOW_DAYS}: +${events.length} eventos`);
  }

  _bucketStore.rotateTo(WAF_SOURCE, nowMin);
  _eventStore.pruneToWindow(WAF_SOURCE, nowMin);
  _syncPhase = "done";
  _syncFinishedAt = new Date().toISOString();
  const stats = _bucketStore.getStats(WAF_SOURCE);
  console.log(`[wafAccumulator] sync completo: ${_eventsLoaded} eventos | ${stats.dimensions} dims`);
}

export async function initWafAccumulator(): Promise<void> {
  setInterval(() => {
    refresh().catch(err => console.error("[wafAccumulator] erro refresh:", err));
  }, 60_000);

  syncFullHistory().catch(err => {
    _syncPhase = "error";
    _syncError = String(err);
    console.error("[wafAccumulator] erro no sync inicial:", err);
  });
}

// ── API pública ──────────────────────────────────────────────────────────────

export function getWafBucketStore(): BucketStore { return _bucketStore; }
export function getWafEventStore(): EventStore<GcEvent> { return _eventStore; }
export function isWafReady(): boolean { return _syncPhase === "done"; }
export function getWafSyncProgress() {
  return {
    phase: _syncPhase, error: _syncError,
    startedAt: _syncStartedAt, finishedAt: _syncFinishedAt, loaded: _eventsLoaded,
  };
}
