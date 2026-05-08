import { createServerFn } from "@tanstack/react-start";
import { fetchSeq, prop, truncHour, emailFrom, clientFrom } from "../../../backend/src/seq";
import {
  getEvents,
  getEventById,
  getBucketStore,
  isReady,
  storeSize,
  storeCoverage,
  getSyncProgress,
  SEQ,
} from "../../../backend/src/accumulators/seqAccumulator";
import { getKongBucketStore, KONG } from "../../../backend/src/accumulators/kongAccumulator";
import {
  getLoginBucketStore, LOGIN, classifyLoginEvent,
  type LoginSource, type LoginFailReason,
} from "../../../backend/src/accumulators/loginAccumulator";
import type { BucketStore } from "../../../backend/src/timeseries/bucketStore";
import type { EventFilters } from "../../../frontend/src/lib/api";

const seqCache = new Map<string, { ts: number; data: unknown }>();
const SEQ_CACHE_TTL_MS = 5 * 60_000;

async function memoizeSeq<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = seqCache.get(key);
  if (hit && Date.now() - hit.ts < SEQ_CACHE_TTL_MS) return hit.data as T;
  const data = await fn();
  seqCache.set(key, { ts: Date.now(), data });
  return data;
}

type SerializedEvent = {
  id: string;
  event_id: string | null;
  timestamp: string;
  message: string | null;
  level: string;
  trace_id: string | null;
  user_id: string | null;
  service: string | null;
  environment: string | null;
  request_path: string | null;
  source_context: string | null;
  raw_data: Record<string, string | number | boolean | null>;
};

function toEvent(e: ReturnType<typeof getEvents>[number], idx: number): SerializedEvent {
  return {
    id: e.event_id || String(idx),
    event_id: e.event_id,
    timestamp: e.timestamp,
    message: e.message,
    level: e.level,
    trace_id: e.trace_id,
    user_id: e.user_id,
    service: e.service,
    environment: e.environment,
    request_path: e.request_path,
    source_context: e.source_context,
    raw_data: e.raw_data as unknown as Record<string, string | number | boolean | null>,
  };
}

function topN(map: Record<string, number>, n: number) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

export const getEventsStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { oldest, newest } = storeCoverage();
  return {
    ready: isReady(),
    events: storeSize(),
    oldest,
    newest,
    progress: getSyncProgress(),
  };
});

export const listEvents = createServerFn({ method: "GET" })
  .inputValidator((input: EventFilters) => input)
  .handler(async ({ data }) => {
    const { level, search = "", page = 1, pageSize = 50 } = data;
    const searchLower = search.toLowerCase();

    let events = getEvents();
    if (level)       events = events.filter(e => e.level === level);
    if (searchLower) events = events.filter(e => e.message?.toLowerCase().includes(searchLower));

    const total      = events.length;
    const safePage   = Math.max(1, page);
    const safeSize   = Math.min(200, pageSize);
    const totalPages = Math.max(1, Math.ceil(total / safeSize));
    const slice      = events.slice((safePage - 1) * safeSize, safePage * safeSize);

    return { data: slice.map(toEvent), total, page: safePage, pageSize: safeSize, totalPages };
  });

export const getEvent = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const event = getEventById(data.id);
    if (!event) throw new Error("Evento não encontrado");
    return toEvent(event, 0);
  });

export const getStatsSummary = createServerFn({ method: "GET" }).handler(async () => {
  const events = getEvents();
  const levelMap: Record<string, number> = {};
  const errorMsgs: Record<string, number> = {};
  const userMap: Record<string, number> = {};
  const serviceMap: Record<string, number> = {};
  let errors = 0;

  for (const e of events) {
    levelMap[e.level] = (levelMap[e.level] ?? 0) + 1;
    if (e.level === "Error" || e.level === "Critical") errors++;
    if (e.level === "Error" && e.message) {
      errorMsgs[e.message] = (errorMsgs[e.message] ?? 0) + 1;
    }
    if (e.user_id) userMap[e.user_id] = (userMap[e.user_id] ?? 0) + 1;
    if (e.service) serviceMap[e.service] = (serviceMap[e.service] ?? 0) + 1;
  }

  const byLevel = Object.entries(levelMap).sort((a, b) => b[1] - a[1])
    .map(([level, count]) => ({ level, count: String(count) }));
  const topErrors = topN(errorMsgs, 10).map(([message, count]) => ({ message, count: String(count) }));
  const topUsers = topN(userMap, 10).map(([user_id, count]) => ({ user_id, count: String(count) }));
  const topServices = topN(serviceMap, 10).map(([service, count]) => ({ service, count: String(count) }));

  return { total: events.length, errors, byLevel, topErrors, topUsers, topServices };
});

export const getTimeline = createServerFn({ method: "GET" })
  .inputValidator((input: { hours?: number }) => input)
  .handler(async ({ data }) => {
    const hours    = Math.min(168, data.hours ?? 24);
    const fromDate = new Date(Date.now() - hours * 3600_000);
    const events   = getEvents().filter(e => new Date(e.timestamp) >= fromDate);

    const map: Record<string, Record<string, number>> = {};
    for (const e of events) {
      const hour = truncHour(e.timestamp);
      if (!map[hour]) map[hour] = {};
      map[hour][e.level] = (map[hour][e.level] ?? 0) + 1;
    }

    const result: { hour: string; level: string; count: string }[] = [];
    for (const hour of Object.keys(map).sort()) {
      for (const [level, count] of Object.entries(map[hour])) {
        result.push({ hour, level, count: String(count) });
      }
    }
    return result;
  });

// Períodos suportados em horas. 240h = 10 dias (limite do bucketStore).
export type AuthPeriodHours = 1 | 6 | 24 | 168 | 240;

function clampPeriod(h: number | undefined): AuthPeriodHours {
  if (h === 1 || h === 6 || h === 24 || h === 168 || h === 240) return h;
  return 24;
}

// Constrói timeline horária a partir do bucketStore (dim: auth_failure, 10d).
// Trunca pra janela `periodHours` mais recente.
function bucketTimelineHourly(periodHours: number, dim: string): { hour: string; count: number }[] {
  return bucketTimelineHourlyFromStore(getBucketStore(), SEQ, periodHours, dim);
}

function bucketTimelineHourlyFromStore(
  store: BucketStore,
  source: string,
  periodHours: number,
  dim: string,
): { hour: string; count: number }[] {
  const nowMin = Math.floor(Date.now() / 60_000);
  const periodMin = periodHours * 60;
  const series = store.getSeries(source, dim, nowMin);
  const startMin = nowMin - periodMin;

  const byHour = new Map<string, number>();
  for (const [m, count] of series.buckets) {
    if (m < startMin) continue;
    const hourMs = Math.floor(m / 60) * 60 * 60_000;
    const hourIso = new Date(hourMs).toISOString();
    byHour.set(hourIso, (byHour.get(hourIso) ?? 0) + count);
  }
  // Preenche horas vazias para gráfico contínuo
  const out: { hour: string; count: number }[] = [];
  const startHourMs = Math.floor((startMin / 60)) * 60 * 60_000;
  const endHourMs   = Math.floor((nowMin / 60))   * 60 * 60_000;
  for (let h = startHourMs; h <= endHourMs; h += 3_600_000) {
    const iso = new Date(h).toISOString();
    out.push({ hour: iso, count: byHour.get(iso) ?? 0 });
  }
  return out;
}

// Timeline do Kong (sucessos + falhas) lendo do kongBucketStore (10d).
function kongTimelineHourly(periodHours: number): { hora: string; sucessos: number; falhas: number }[] {
  const okSeries   = bucketTimelineHourlyFromStore(getKongBucketStore(), KONG, periodHours, "kong_ok");
  const failSeries = bucketTimelineHourlyFromStore(getKongBucketStore(), KONG, periodHours, "kong_fail");
  const failByHour = new Map(failSeries.map(p => [p.hour, p.count]));
  return okSeries.map(p => ({
    hora: p.hour,
    sucessos: p.count,
    falhas: failByHour.get(p.hour) ?? 0,
  }));
}

export const getAuthErrorStats = createServerFn({ method: "GET" })
  .inputValidator((data: { period?: number } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const period = clampPeriod(data?.period);
    const fromDate = new Date(Date.now() - period * 3600 * 1000);

    return memoizeSeq(`getAuthErrorStats:${period}`, async () => {
    const auth = await fetchSeq({
      filter:   "Contains(@Message, 'Erro autenticação')",
      fromDate,
      maxTotal: 10000,
    });

    const tlMap: Record<string, { count: number; users: Set<string> }> = {};
    const userAgg: Record<string, { count: number; last_seen: string }> = {};
    const clientCount: Record<string, number> = {};

    for (const e of auth) {
      const h = truncHour(e.timestamp);
      if (!tlMap[h]) tlMap[h] = { count: 0, users: new Set() };
      tlMap[h].count++;

      const em = emailFrom(e.message || "");
      if (em) {
        tlMap[h].users.add(em);
        if (!userAgg[em]) userAgg[em] = { count: 0, last_seen: e.timestamp };
        userAgg[em].count++;
        if (e.timestamp > userAgg[em].last_seen) userAgg[em].last_seen = e.timestamp;
      }

      const cl = clientFrom(e.message || "");
      if (cl) clientCount[cl] = (clientCount[cl] ?? 0) + 1;
    }

    // Timeline vem do bucketStore (auth_failure, até 10d). Mais robusto que
    // tlMap derivado de fetchSeq que é capado em 10k eventos.
    const bucketSeries = bucketTimelineHourly(period, "auth_failure");
    const timeline = bucketSeries.map(({ hour, count }) => ({
      hour,
      count: String(count),
      // unique_users só calculável a partir dos eventos do fetchSeq
      unique_users: String(tlMap[hour]?.users.size ?? 0),
    }));

    const topUsers = Object.entries(userAgg)
      .sort((a, b) => b[1].count - a[1].count).slice(0, 20)
      .map(([email, v]) => ({
        email, count: String(v.count), last_seen: v.last_seen,
      }));

    const topClients = topN(clientCount, 10)
      .map(([client_id, count]) => ({ client_id, count: String(count) }));

    const recentEvents = auth.slice(0, 100).map((e, i) => ({
      id: e.event_id || i,
      event_id:     e.event_id || "",
      timestamp:    e.timestamp,
      message:      e.message,
      level:        e.level,
      trace_id:     e.trace_id,
      request_path: e.request_path,
    }));

    return { total: auth.length, period, timeline, topUsers, topClients, recentEvents };
    });
  });

export const getKongAuthStats = createServerFn({ method: "GET" })
  .inputValidator((data: { period?: number } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const period = clampPeriod(data?.period);
    const fromDate = new Date(Date.now() - period * 3600 * 1000);

    return memoizeSeq(`getKongAuthStats:${period}`, async () => {
    const kongAll = await fetchSeq({
      filter:   "@Message = 'Kong Auth Request'",
      fromDate,
      maxTotal: 10000,
    });

    let successes = 0;
    let fail401 = 0;
    let fail500 = 0;
    const userAgg: Record<string, { falhas: number; first: string; last: string }> = {};
    const ipAgg: Record<string, { falhas: number; users: Set<string>; first: string; last: string }> = {};
    const anonAgg: Record<string, { count: number; ips: Set<string> }> = {};
    const serverErrors: { timestamp: string; username: string | null; client_ip: string | null; path: string | null }[] = [];
    const recentFailures: { id: number; timestamp: string; username: string | null; client_ip: string | null; path: string | null; status_code: number; module: string | null }[] = [];
    const emailRe = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

    for (const e of kongAll) {
      const status = Number(prop(e, "StatusCode"));
      const isOk = status === 200;
      if (isOk) {
        successes++;
        continue;
      }

      if (status === 401) fail401++;
      if (status === 500) fail500++;

      const username = prop(e, "Username") || "";
      const ip = prop(e, "ClientIP") || "";
      const path = prop(e, "Path");

      if (username) {
        if (!userAgg[username]) userAgg[username] = { falhas: 0, first: e.timestamp, last: e.timestamp };
        userAgg[username].falhas++;
        if (e.timestamp < userAgg[username].first) userAgg[username].first = e.timestamp;
        if (e.timestamp > userAgg[username].last) userAgg[username].last = e.timestamp;

        if (!emailRe.test(username)) {
          if (!anonAgg[username]) anonAgg[username] = { count: 0, ips: new Set() };
          anonAgg[username].count++;
          if (ip) anonAgg[username].ips.add(ip);
        }
      }

      if (ip) {
        if (!ipAgg[ip]) ipAgg[ip] = { falhas: 0, users: new Set(), first: e.timestamp, last: e.timestamp };
        ipAgg[ip].falhas++;
        if (username) ipAgg[ip].users.add(username);
        if (e.timestamp < ipAgg[ip].first) ipAgg[ip].first = e.timestamp;
        if (e.timestamp > ipAgg[ip].last) ipAgg[ip].last = e.timestamp;
      }

      if (status === 500) {
        serverErrors.push({ timestamp: e.timestamp, username: prop(e, "Username"), client_ip: prop(e, "ClientIP"), path });
      }
      if (recentFailures.length < 50) {
        recentFailures.push({
          id: recentFailures.length, timestamp: e.timestamp,
          username: prop(e, "Username"), client_ip: prop(e, "ClientIP"), path,
          status_code: status, module: prop(e, "Module"),
        });
      }
    }

    const total = kongAll.length;
    const failures = total - successes;

    // Timeline vem do kongBucketStore (10d) — independe do cap de 10k de fetchSeq
    // e cobre períodos > retenção viva do Seq (~6h).
    const timeline = kongTimelineHourly(period);
    const topUsers = Object.entries(userAgg)
      .sort((a, b) => b[1].falhas - a[1].falhas).slice(0, 20)
      .map(([username, v]) => ({
        username, falhas: String(v.falhas), first_seen: v.first, last_seen: v.last,
      }));
    const topIPs = Object.entries(ipAgg)
      .sort((a, b) => b[1].falhas - a[1].falhas).slice(0, 15)
      .map(([client_ip, v]) => ({
        client_ip, falhas: String(v.falhas), usuarios_unicos: String(v.users.size),
        first_seen: v.first, last_seen: v.last,
      }));
    const stuffing = Object.entries(ipAgg)
      .filter(([, v]) => v.users.size >= 3)
      .sort((a, b) => b[1].users.size - a[1].users.size)
      .map(([client_ip, v]) => {
        const ms = new Date(v.last).getTime() - new Date(v.first).getTime();
        return {
          client_ip, usuarios_tentados: String(v.users.size), total_falhas: String(v.falhas),
          janela_min: String((ms / 60000).toFixed(1)), first_seen: v.first, last_seen: v.last,
        };
      });
    const anomalousUsernames = Object.entries(anonAgg)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([username, v]) => ({
        username, client_ip: [...v.ips].join(", "), tentativas: String(v.count),
      }));

    return {
      summary: {
        total, failures, successes, failures401: fail401, failures500: fail500,
        failurePct: total > 0 ? parseFloat((failures / total * 100).toFixed(1)) : 0,
      },
      period,
      timeline, topUsers, topIPs, credentialStuffing: stuffing,
      anomalousUsernames, serverErrors, recentFailures,
    };
    });
  });

// ── Login Overview (multi-source: Kong + IS4 + Authentication Common) ───────

const LOGIN_FILTER_FN =
  "(@Message = 'Kong Auth Request') " +
  "or (Contains(@SourceContext, 'IdentityServer4.Events')) " +
  "or (Contains(@Message, 'Erro autenticação'))";

function bucketSumOver(store: BucketStore, source: string, dim: string, periodHours: number): number {
  const nowMin = Math.floor(Date.now() / 60_000);
  const startMin = nowMin - periodHours * 60;
  const series = store.getSeries(source, dim, nowMin);
  let sum = 0;
  for (const [m, c] of series.buckets) if (m >= startMin) sum += c;
  return sum;
}

export const getLoginOverview = createServerFn({ method: "GET" })
  .inputValidator((data: { period?: number } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const period = clampPeriod(data?.period);
    const fromDate = new Date(Date.now() - period * 3600 * 1000);

    return memoizeSeq(`getLoginOverview:${period}`, async () => {
    const store = getLoginBucketStore();

    // Summary do bucket (cobre 10d sem cap de fetchSeq)
    const total       = bucketSumOver(store, LOGIN, "login_total", period);
    const ok          = bucketSumOver(store, LOGIN, "login_ok", period);
    const fail        = bucketSumOver(store, LOGIN, "login_fail", period);
    const internal    = bucketSumOver(store, LOGIN, "login_class:internal", period);
    const external    = bucketSumOver(store, LOGIN, "login_class:external", period);
    const sourceTotals = {
      kong:        bucketSumOver(store, LOGIN, "login_source:kong", period),
      is_web:      bucketSumOver(store, LOGIN, "login_source:is_web", period),
      is_api:      bucketSumOver(store, LOGIN, "login_source:is_api", period),
      auth_common: bucketSumOver(store, LOGIN, "login_source:auth_common", period),
    };
    const failureReasons = (
      ["invalid_credentials", "invalid_grant", "unauthorized", "server_error", "other"] as LoginFailReason[]
    ).map((r) => ({ reason: r, count: bucketSumOver(store, LOGIN, `login_fail_reason:${r}`, period) }))
     .filter((r) => r.count > 0)
     .sort((a, b) => b.count - a.count);

    // Timeline empilhada por source/outcome (10d via bucketStore)
    const okHourly  = bucketTimelineHourlyFromStore(store, LOGIN, period, "login_ok");
    const failHourly = bucketTimelineHourlyFromStore(store, LOGIN, period, "login_fail");
    const kongHourly = bucketTimelineHourlyFromStore(store, LOGIN, period, "login_source:kong");
    const isWebHourly = bucketTimelineHourlyFromStore(store, LOGIN, period, "login_source:is_web");
    const isApiHourly = bucketTimelineHourlyFromStore(store, LOGIN, period, "login_source:is_api");
    const authCommonHourly = bucketTimelineHourlyFromStore(store, LOGIN, period, "login_source:auth_common");
    const indexBy = (arr: { hour: string; count: number }[]) => new Map(arr.map(p => [p.hour, p.count]));
    const failIdx = indexBy(failHourly);
    const kongIdx = indexBy(kongHourly);
    const isWebIdx = indexBy(isWebHourly);
    const isApiIdx = indexBy(isApiHourly);
    const authCommonIdx = indexBy(authCommonHourly);
    const timeline = okHourly.map(p => ({
      hora: p.hour,
      ok:          p.count,
      fail:        failIdx.get(p.hour) ?? 0,
      kong:        kongIdx.get(p.hour) ?? 0,
      is_web:      isWebIdx.get(p.hour) ?? 0,
      is_api:      isApiIdx.get(p.hour) ?? 0,
      auth_common: authCommonIdx.get(p.hour) ?? 0,
    }));

    // Drill-downs vivos (cap em retenção do Seq + 10k events)
    const liveEvents = await fetchSeq({ filter: LOGIN_FILTER_FN, fromDate, maxTotal: 10_000 });
    const userAgg: Record<string, { falhas: number; sucessos: number; sources: Set<LoginSource>; last: string }> = {};
    const ipAgg: Record<string, { falhas: number; users: Set<string>; last: string }> = {};
    const recentFailures: {
      id: number; timestamp: string; source: LoginSource; username: string | null;
      client_ip: string | null; client_id: string | null; reason: LoginFailReason | null;
    }[] = [];

    for (const e of liveEvents) {
      const c = classifyLoginEvent(e);
      if (!c.source || !c.outcome) continue;

      if (c.username) {
        if (!userAgg[c.username]) userAgg[c.username] = { falhas: 0, sucessos: 0, sources: new Set(), last: e.timestamp };
        if (c.outcome === "fail") userAgg[c.username].falhas++;
        else userAgg[c.username].sucessos++;
        userAgg[c.username].sources.add(c.source);
        if (e.timestamp > userAgg[c.username].last) userAgg[c.username].last = e.timestamp;
      }

      if (c.source === "kong" && c.client_ip) {
        if (!ipAgg[c.client_ip]) ipAgg[c.client_ip] = { falhas: 0, users: new Set(), last: e.timestamp };
        if (c.outcome === "fail") ipAgg[c.client_ip].falhas++;
        if (c.username) ipAgg[c.client_ip].users.add(c.username);
        if (e.timestamp > ipAgg[c.client_ip].last) ipAgg[c.client_ip].last = e.timestamp;
      }

      if (c.outcome === "fail" && recentFailures.length < 50) {
        recentFailures.push({
          id: recentFailures.length, timestamp: e.timestamp,
          source: c.source, username: c.username, client_ip: c.client_ip,
          client_id: c.client_id, reason: c.reason,
        });
      }
    }

    const topUsers = Object.entries(userAgg)
      .sort((a, b) => b[1].falhas - a[1].falhas)
      .slice(0, 20)
      .map(([username, v]) => ({
        username, falhas: v.falhas, sucessos: v.sucessos,
        sources: [...v.sources].filter(Boolean) as LoginSource[],
        last_seen: v.last,
      }));
    const topIPs = Object.entries(ipAgg)
      .sort((a, b) => b[1].falhas - a[1].falhas)
      .slice(0, 15)
      .map(([client_ip, v]) => ({
        client_ip, falhas: v.falhas, usuarios_unicos: v.users.size,
        last_seen: v.last,
        is_internal: /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(client_ip),
      }));

    return {
      summary: {
        total, ok, fail,
        failurePct: total > 0 ? parseFloat((fail / total * 100).toFixed(1)) : 0,
        internal, external,
        sources: sourceTotals,
      },
      period,
      timeline,
      topUsers,
      topIPs,
      failureReasons,
      recentFailures,
    };
    });
  });
