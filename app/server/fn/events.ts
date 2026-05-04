import { createServerFn } from "@tanstack/react-start";
import { fetchSeq, prop, truncHour, emailFrom, clientFrom } from "../../../backend/src/seq";
import {
  getEvents,
  getEventById,
  isReady,
  storeSize,
  storeCoverage,
  getSyncProgress,
} from "../../../backend/src/accumulator";
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

export const getAuthErrorStats = createServerFn({ method: "GET" }).handler(async () =>
  memoizeSeq("getAuthErrorStats", async () => {
    const auth = await fetchSeq({
      filter:   "Contains(@Message, 'Erro autenticação')",
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

    const timeline = Object.keys(tlMap).sort().map(h => ({
      hour: h, count: String(tlMap[h].count), unique_users: String(tlMap[h].users.size),
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

    return { total: auth.length, timeline, topUsers, topClients, recentEvents };
  }),
);

export const getKongAuthStats = createServerFn({ method: "GET" }).handler(async () =>
  memoizeSeq("getKongAuthStats", async () => {
    const kongAll = await fetchSeq({
      filter:   "@Message = 'Kong Auth Request'",
      maxTotal: 10000,
    });

    let successes = 0;
    let fail401 = 0;
    let fail500 = 0;
    const tlMap: Record<string, { f: number; s: number }> = {};
    const userAgg: Record<string, { falhas: number; first: string; last: string }> = {};
    const ipAgg: Record<string, { falhas: number; users: Set<string>; first: string; last: string }> = {};
    const anonAgg: Record<string, { count: number; ips: Set<string> }> = {};
    const serverErrors: { timestamp: string; username: string | null; client_ip: string | null; path: string | null }[] = [];
    const recentFailures: { id: number; timestamp: string; username: string | null; client_ip: string | null; path: string | null; status_code: number; module: string | null }[] = [];
    const emailRe = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

    for (const e of kongAll) {
      const status = Number(prop(e, "StatusCode"));
      const isOk = status === 200;
      const h = truncHour(e.timestamp);
      if (!tlMap[h]) tlMap[h] = { f: 0, s: 0 };
      if (isOk) {
        tlMap[h].s++;
        successes++;
        continue;
      }

      tlMap[h].f++;
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

    const timeline = Object.keys(tlMap).sort().map(h => ({
      hora: h, falhas: tlMap[h].f, sucessos: tlMap[h].s,
    }));
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
      timeline, topUsers, topIPs, credentialStuffing: stuffing,
      anomalousUsernames, serverErrors, recentFailures,
    };
  }),
);
