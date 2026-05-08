// Login accumulator — eventos de autenticação unificados (Kong + IdentityServer4
// + Authentication Common) bucketizados em memória. Polling 60s + backfill 10d.
//
// Sources cobertos (todos com nível Information, fora do LEVEL_FILTER do
// seqAccumulator):
//   - kong          @Message = 'Kong Auth Request'
//   - is_web        IS4 Events: UserLoginSuccessEvent / UserLoginFailureEvent
//   - is_api        IS4 Events: TokenIssuedSuccessEvent / TokenIssuedFailureEvent
//   - auth_common   Contains(@Message, 'Erro autenticação')
//
// Dimensões geradas:
//   login_total
//   login_ok                                — sucessos
//   login_fail                              — falhas
//   login_source:{kong|is_web|is_api|auth_common}
//   login_class:internal|external           — só Kong (único com IP real do cliente)
//   login_fail_reason:{invalid_credentials|invalid_grant|unauthorized|server_error|other}

import { fetchSeq, ParsedEvent } from "../seq";
import type { SeqApiEvent } from "../types";
import { BucketStore, tsToMinute } from "../timeseries/bucketStore";
import { REFERENCE_WINDOW_DAYS } from "../timeseries/types";

const LOGIN_FILTER =
  "(@Message = 'Kong Auth Request') " +
  "or (Contains(@SourceContext, 'IdentityServer4.Events')) " +
  "or (Contains(@Message, 'Erro autenticação'))";

const _bucketStore = new BucketStore();
const LOGIN_SOURCE = "login";
export const LOGIN = LOGIN_SOURCE;

let _latestSeqId: string | undefined;

let _syncPhase: "idle" | "syncing" | "done" | "error" = "idle";
let _syncError: string | null = null;
let _syncStartedAt: string | null = null;
let _syncFinishedAt: string | null = null;
let _eventsLoaded = 0;

// ── Classification helpers ────────────────────────────────────────────────────

interface IsEventPayload {
  _typeTag?: string;
  Username?: string | null;
  SubjectId?: string | null;
  ClientId?: string | null;
  Endpoint?: string | null;
  Error?: string | null;
  ErrorDescription?: string | null;
  Message?: string | null;
  EventType?: string | null;
  RemoteIpAddress?: string | null;
}

function rawProp(e: ParsedEvent, name: string): unknown {
  const raw = e.raw_data as SeqApiEvent;
  return (raw.Properties || []).find((p) => p.Name === name)?.Value;
}

function strProp(e: ParsedEvent, name: string): string | null {
  const v = rawProp(e, name);
  return v != null ? String(v) : null;
}

function isInternalIp(ip: string | null): boolean {
  if (!ip) return false;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

export type LoginSource = "kong" | "is_web" | "is_api" | "auth_common";
export type LoginOutcome = "ok" | "fail";
export type LoginFailReason =
  | "invalid_credentials"
  | "invalid_grant"
  | "unauthorized"
  | "server_error"
  | "other";

export interface LoginClassification {
  source: LoginSource | null;
  outcome: LoginOutcome | null;
  reason: LoginFailReason | null;
  username: string | null;
  client_ip: string | null; // só populado em Kong (IP real do cliente)
  client_id: string | null; // ClientId do IS / Auth Common
}

function classify(e: ParsedEvent): LoginClassification {
  const message = e.message ?? "";
  const sourceCtx = e.source_context ?? "";

  // Kong Auth Request
  if (message === "Kong Auth Request") {
    const status = Number(strProp(e, "StatusCode"));
    const ok = status === 200;
    return {
      source: "kong",
      outcome: ok ? "ok" : "fail",
      reason: ok
        ? null
        : status === 401
          ? "unauthorized"
          : status === 500
            ? "server_error"
            : "other",
      username: strProp(e, "Username"),
      client_ip: strProp(e, "ClientIP"),
      client_id: null,
    };
  }

  // IdentityServer4 events — payload in `event` property
  if (sourceCtx.includes("IdentityServer4.Events")) {
    const payload = (rawProp(e, "event") as IsEventPayload | undefined) ?? {};
    const tag = payload._typeTag ?? "";
    const eventType = payload.EventType ?? "";
    const ok = eventType === "Success" || tag.endsWith("SuccessEvent");

    let source: LoginSource | null = null;
    if (tag.startsWith("UserLogin")) source = "is_web";
    else if (tag.startsWith("TokenIssued")) source = "is_api";

    let reason: LoginFailReason | null = null;
    if (!ok) {
      const err = (payload.Error ?? "").toLowerCase();
      const desc = (payload.ErrorDescription ?? payload.Message ?? "").toLowerCase();
      if (desc.includes("invalid_username_or_password")) reason = "invalid_credentials";
      else if (err === "invalid_grant") reason = "invalid_grant";
      else if (err === "unauthorized_client" || err.includes("unauthorized")) reason = "unauthorized";
      else reason = "other";
    }

    return {
      source,
      outcome: ok ? "ok" : "fail",
      reason,
      username: payload.Username ?? null,
      client_ip: null, // RemoteIpAddress é IP do LB interno — não usar
      client_id: payload.ClientId ?? null,
    };
  }

  // Authentication Common — sempre falha
  if (message.startsWith("Erro autenticação")) {
    const status = (strProp(e, "StatusCode") ?? "").toLowerCase();
    const err = (strProp(e, "Error") ?? "").toLowerCase();
    const reason: LoginFailReason =
      err === "invalid_grant"
        ? "invalid_grant"
        : status === "unauthorized" || err === "unauthorized"
          ? "unauthorized"
          : status.includes("badrequest")
            ? "invalid_credentials"
            : "other";
    return {
      source: "auth_common",
      outcome: "fail",
      reason,
      username: strProp(e, "User"),
      client_ip: null,
      client_id: strProp(e, "ClientId"),
    };
  }

  return { source: null, outcome: null, reason: null, username: null, client_ip: null, client_id: null };
}

export function dimensionsForLoginEvent(e: ParsedEvent): Record<string, number> {
  const c = classify(e);
  if (!c.source || !c.outcome) return {};
  const out: Record<string, number> = {
    login_total: 1,
    [`login_source:${c.source}`]: 1,
  };
  if (c.outcome === "ok") out.login_ok = 1;
  else out.login_fail = 1;

  if (c.source === "kong" && c.client_ip) {
    out[`login_class:${isInternalIp(c.client_ip) ? "internal" : "external"}`] = 1;
  }

  if (c.outcome === "fail" && c.reason) {
    out[`login_fail_reason:${c.reason}`] = 1;
  }

  return out;
}

// ── Ingest / fetch loop ───────────────────────────────────────────────────────

function ingest(events: ParsedEvent[]): void {
  if (events.length === 0) return;
  const byMinute = new Map<number, Record<string, number>>();
  for (const e of events) {
    if (!e.event_id) continue;
    const dims = dimensionsForLoginEvent(e);
    if (Object.keys(dims).length === 0) continue;
    const minute = tsToMinute(e.timestamp);
    let acc = byMinute.get(minute);
    if (!acc) { acc = {}; byMinute.set(minute, acc); }
    for (const [k, n] of Object.entries(dims)) acc[k] = (acc[k] ?? 0) + n;
  }
  for (const [minute, dims] of byMinute) {
    _bucketStore.bumpMany(LOGIN_SOURCE, minute, dims);
  }
}

async function refresh(): Promise<void> {
  const raw = await fetchSeq({
    filter: LOGIN_FILTER,
    maxTotal: 5000,
    stopAtId: _latestSeqId,
  });
  if (raw.length === 0) return;
  const nowMin = Math.floor(Date.now() / 60_000);
  ingest(raw);
  console.log(`[loginAccumulator] +${raw.length} novos`);
  if (raw[0]?.event_id) _latestSeqId = raw[0].event_id;
  _bucketStore.rotateTo(LOGIN_SOURCE, nowMin);
}

async function syncDay(d: number): Promise<ParsedEvent[]> {
  const to = new Date(Date.now() - (d - 1) * 86_400_000);
  const from = new Date(Date.now() - d * 86_400_000);
  try {
    const events = await fetchSeq({
      filter: LOGIN_FILTER,
      fromDate: from,
      toDate: to,
      maxTotal: 100_000,
    });
    console.log(`[loginAccumulator] dia ${d}/${REFERENCE_WINDOW_DAYS}: +${events.length} eventos`);
    return events;
  } catch (err) {
    console.error(`[loginAccumulator] erro no dia ${d}:`, err);
    return [];
  }
}

async function syncFullHistory(): Promise<void> {
  _syncPhase = "syncing";
  _syncStartedAt = new Date().toISOString();
  _syncError = null;
  _eventsLoaded = 0;

  console.log(`[loginAccumulator] sync inicial: ${REFERENCE_WINDOW_DAYS} dias`);
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

  _bucketStore.rotateTo(LOGIN_SOURCE, nowMin);
  _syncPhase = "done";
  _syncFinishedAt = new Date().toISOString();
  const stats = _bucketStore.getStats(LOGIN_SOURCE);
  console.log(`[loginAccumulator] sync completo: ${_eventsLoaded} eventos | ${stats.dimensions} dims`);
}

export async function initLoginAccumulator(): Promise<void> {
  setInterval(() => {
    refresh().catch(err => console.error("[loginAccumulator] erro refresh:", err));
  }, 60_000);
  syncFullHistory().catch(err => {
    _syncPhase = "error";
    _syncError = String(err);
    console.error("[loginAccumulator] erro no sync inicial:", err);
  });
}

// ── API pública ──────────────────────────────────────────────────────────────

export function getLoginBucketStore(): BucketStore { return _bucketStore; }
export function isLoginReady(): boolean { return _syncPhase === "done"; }
export function getLoginSyncProgress() {
  return {
    phase: _syncPhase, error: _syncError,
    startedAt: _syncStartedAt, finishedAt: _syncFinishedAt, loaded: _eventsLoaded,
  };
}

// Re-export classify para uso pelo server fn (pra reaproveitar mesma lógica
// em drill-downs de eventos vivos).
export { classify as classifyLoginEvent };
