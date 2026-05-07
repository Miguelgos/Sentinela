// Audit accumulator — logs Loki de Integra, customer360, fieldservice.
// Polling 60s + backfill 10d (limitado pela retenção real do Loki).
//
// Dimensões geradas:
//   total
//   service:Integra | customer360 | fieldservice
//   service:X:user:{userId}     — top-20 users por service (cap dinâmico)
//   service:X:external_ip       — quando IP é externo (não-RFC1918)
//   service:X:unmasked          — quando ViewMaskedData=true

import { lokiQueryRange, type LokiStream } from "../lib/lokiClient";
import { BucketStore } from "../timeseries/bucketStore";
import { EventStore } from "../timeseries/eventStore";
import { REFERENCE_WINDOW_DAYS, EVENT_STORE_WINDOW_MIN } from "../timeseries/types";

export interface AuditEvent {
  service: "Integra" | "customer360" | "fieldservice";
  timestamp: string;       // ISO
  userId: string;
  ip: string;
  page?: string;
  unmasked: boolean;
  raw: string;             // linha original do Loki (pra drill-down)
}

const _bucketStore = new BucketStore();
const _eventStore = new EventStore<AuditEvent>();
const AUDIT_SOURCE = "audit";

export const AUDIT = AUDIT_SOURCE;

const TOP_USERS_PER_SERVICE = 20;

// Heatmap por (service, user) — usado pra decidir quem entra no top-N.
// Reaproveitamos o próprio bucketStore (dim "service:X:user_count:userId" agregado).
// Mais simples: contador local por service que decide top-N a cada minuto.
const _userVolumeBySvc: Record<string, Map<string, number>> = {};

function isExternalIp(ip: string): boolean {
  if (!ip) return false;
  const cleaned = ip.replace(/^::ffff:/, "");
  if (cleaned.startsWith("10.")) return false;
  if (cleaned.startsWith("172.")) {
    const octet = parseInt(cleaned.split(".")[1] ?? "0", 10);
    if (octet >= 16 && octet <= 31) return false;
  }
  if (cleaned.startsWith("192.168.")) return false;
  if (cleaned === "127.0.0.1" || cleaned === "::1" || cleaned === "") return false;
  return true;
}

function parseLokiLine(service: AuditEvent["service"], tsNs: string, line: string): AuditEvent | null {
  try {
    const outer = JSON.parse(line) as Record<string, unknown>;
    const fields = (service === "customer360" && typeof outer.Message === "string")
      ? JSON.parse(outer.Message) as Record<string, unknown>
      : outer;
    const userId = String(fields.CD_USUARIO ?? "").trim();
    const ip = String(fields.IP_USUARIO ?? "").replace(/^::ffff:/, "");
    let unmasked = false;
    const jsParams = fields.JS_PARAMETROS;
    if (jsParams) {
      try {
        const p = typeof jsParams === "string" ? JSON.parse(jsParams) as Record<string, unknown> : jsParams as Record<string, unknown>;
        unmasked = p.ViewMaskedData === true || p.ViewMaskedData === "true";
      } catch {
        if (typeof jsParams === "string" && jsParams.includes("ViewMaskedData") && jsParams.includes("true")) unmasked = true;
      }
    }
    const tsMs = Math.floor(Number(tsNs) / 1_000_000);
    return {
      service,
      timestamp: new Date(tsMs).toISOString(),
      userId,
      ip,
      page: typeof fields.PAGINA === "string" ? fields.PAGINA : undefined,
      unmasked,
      raw: line,
    };
  } catch {
    return null;
  }
}

function userTopN(svc: string, userId: string): boolean {
  // Mantém só top-N por service. Implementação pragmática: a cada bump,
  // se o user é novo e já temos N, descarta. Uma vez no top-N permanece.
  let map = _userVolumeBySvc[svc];
  if (!map) { map = new Map(); _userVolumeBySvc[svc] = map; }
  if (map.has(userId)) {
    map.set(userId, (map.get(userId) ?? 0) + 1);
    return true;
  }
  if (map.size < TOP_USERS_PER_SERVICE) {
    map.set(userId, 1);
    return true;
  }
  return false;
}

export function dimensionsForAuditEvent(e: AuditEvent): Record<string, number> {
  const out: Record<string, number> = { total: 1 };
  out[`service:${e.service}`] = 1;
  if (e.userId && userTopN(e.service, e.userId)) {
    out[`service:${e.service}:user:${e.userId}`] = 1;
  }
  if (isExternalIp(e.ip)) out[`service:${e.service}:external_ip`] = 1;
  if (e.unmasked) out[`service:${e.service}:unmasked`] = 1;
  return out;
}

function ingest(events: AuditEvent[], nowMin: number): void {
  if (events.length === 0) return;
  const byMinute = new Map<number, Record<string, number>>();
  const eventBatch: { eventId: string; event: AuditEvent; timestamp: number }[] = [];

  for (const e of events) {
    const tsMs = Date.parse(e.timestamp);
    if (isNaN(tsMs)) continue;
    const minute = Math.floor(tsMs / 60_000);

    const dims = dimensionsForAuditEvent(e);
    let acc = byMinute.get(minute);
    if (!acc) { acc = {}; byMinute.set(minute, acc); }
    for (const [k, n] of Object.entries(dims)) acc[k] = (acc[k] ?? 0) + n;

    if (minute >= nowMin - EVENT_STORE_WINDOW_MIN) {
      const id = `${e.service}|${e.userId}|${tsMs}|${e.page ?? ""}`;
      eventBatch.push({ eventId: id, event: e, timestamp: minute });
    }
  }

  for (const [minute, dims] of byMinute) {
    _bucketStore.bumpMany(AUDIT_SOURCE, minute, dims);
  }
  _eventStore.putMany(AUDIT_SOURCE, eventBatch);
}

const SERVICES: AuditEvent["service"][] = ["Integra", "customer360", "fieldservice"];

async function fetchLokiAudit(service: AuditEvent["service"], fromNs: number, toNs: number, limit: number): Promise<AuditEvent[]> {
  const query = service === "customer360"
    ? `{app="customer360",log_type="audit"}`
    : service === "fieldservice"
    ? `{app="fieldservice",log_type="audit"}`
    : `{app="Integra",log_type="audit"}`;

  const streams = await lokiQueryRange(query, fromNs, toNs, limit);
  const out: AuditEvent[] = [];
  for (const stream of streams) {
    for (const [tsNs, line] of stream.values) {
      const ev = parseLokiLine(service, tsNs, line);
      if (ev) out.push(ev);
    }
  }
  return out;
}

let _syncPhase: "idle" | "syncing" | "done" | "error" = "idle";
let _syncError: string | null = null;
let _eventsLoaded = 0;

async function refresh(): Promise<void> {
  const toNs = Date.now() * 1_000_000;
  const fromNs = (Date.now() - 120_000) * 1_000_000; // últimos 2 min com overlap

  const all: AuditEvent[] = [];
  for (const svc of SERVICES) {
    try {
      const evs = await fetchLokiAudit(svc, fromNs, toNs, 500);
      all.push(...evs);
    } catch (err) {
      console.error(`[auditAccumulator] erro fetch ${svc}:`, err);
    }
  }
  if (all.length === 0) return;

  const nowMin = Math.floor(Date.now() / 60_000);
  ingest(all, nowMin);
  _bucketStore.rotateTo(AUDIT_SOURCE, nowMin);
  _eventStore.pruneToWindow(AUDIT_SOURCE, nowMin);
}

async function syncFullHistory(): Promise<void> {
  _syncPhase = "syncing";
  _syncError = null;
  _eventsLoaded = 0;
  console.log(`[auditAccumulator] sync inicial: ${REFERENCE_WINDOW_DAYS} dias`);
  const nowMin = Math.floor(Date.now() / 60_000);

  for (let d = REFERENCE_WINDOW_DAYS; d >= 1; d--) {
    const toNs = (Date.now() - (d - 1) * 86_400_000) * 1_000_000;
    const fromNs = (Date.now() - d * 86_400_000) * 1_000_000;
    let dayCount = 0;
    for (const svc of SERVICES) {
      try {
        const evs = await fetchLokiAudit(svc, fromNs, toNs, 5000);
        ingest(evs, nowMin);
        dayCount += evs.length;
      } catch (err) {
        console.error(`[auditAccumulator] erro dia ${d} ${svc}:`, err);
      }
    }
    _eventsLoaded += dayCount;
    console.log(`[auditAccumulator] dia ${REFERENCE_WINDOW_DAYS - d + 1}/${REFERENCE_WINDOW_DAYS}: +${dayCount} eventos`);
  }

  _bucketStore.rotateTo(AUDIT_SOURCE, nowMin);
  _eventStore.pruneToWindow(AUDIT_SOURCE, nowMin);
  _syncPhase = "done";
  const stats = _bucketStore.getStats(AUDIT_SOURCE);
  console.log(`[auditAccumulator] sync completo: ${_eventsLoaded} eventos | ${stats.dimensions} dims`);
}

export async function initAuditAccumulator(): Promise<void> {
  setInterval(() => {
    refresh().catch(err => console.error("[auditAccumulator] erro refresh:", err));
  }, 60_000);
  syncFullHistory().catch(err => {
    _syncPhase = "error";
    _syncError = String(err);
    console.error("[auditAccumulator] erro no sync inicial:", err);
  });
}

// ── API pública ──────────────────────────────────────────────────────────────

export function getAuditBucketStore(): BucketStore { return _bucketStore; }
export function getAuditEventStore(): EventStore<AuditEvent> { return _eventStore; }
export function isAuditReady(): boolean { return _syncPhase === "done"; }
export function getAuditSyncProgress() {
  return { phase: _syncPhase, error: _syncError, loaded: _eventsLoaded };
}
