"use server";
import { createServerFn } from "@tanstack/react-start";
import { fetchSeq, prop, truncHour } from "../../../backend/src/seq";
import {
  getEvents,
  isReady,
  storeSize,
  storeCoverage,
  getSyncProgress,
} from "../../../backend/src/accumulator";
import type { EventFilters } from "../../../frontend/src/lib/api";

// Cache simples em memória pra reduzir requests ao Seq (limite de licença).
// Cada handler que bate direto no Seq deve passar por aqui.
const seqCache = new Map<string, { ts: number; data: unknown }>();
const SEQ_CACHE_TTL_MS = 5 * 60_000;

async function memoizeSeq<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = seqCache.get(key);
  if (hit && Date.now() - hit.ts < SEQ_CACHE_TTL_MS) return hit.data as T;
  const data = await fn();
  seqCache.set(key, { ts: Date.now(), data });
  return data;
}

// ── helpers ──────────────────────────────────────────────────────────────────

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
    // Stringify via JSON to produce serializable primitives only
    raw_data: JSON.parse(JSON.stringify(e.raw_data ?? {})) as Record<string, string | number | boolean | null>,
  };
}

function countBy<T>(arr: T[], key: (x: T) => string | null | undefined): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of arr) {
    const k = key(x);
    if (k) m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

function topN(map: Record<string, number>, n: number) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function emailFrom(msg: string): string | null {
  return msg?.match(/User:\s*(\S+)\s*\|/)?.[1] ?? null;
}
function clientFrom(msg: string): string | null {
  return msg?.match(/ClientId:\s*(\S+)[\s|]/)?.[1] ?? null;
}

// ── getEventsStatus ───────────────────────────────────────────────────────────

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

// ── listEvents ────────────────────────────────────────────────────────────────

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

// ── getEvent ──────────────────────────────────────────────────────────────────

export const getEvent = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const event = getEvents().find(e => e.event_id === data.id);
    if (!event) throw new Error("Evento não encontrado");
    return toEvent(event, 0);
  });

// ── getStatsSummary ───────────────────────────────────────────────────────────

export const getStatsSummary = createServerFn({ method: "GET" }).handler(async () => {
  const events = getEvents();
  const total  = events.length;
  const errors = events.filter(e => e.level === "Error" || e.level === "Critical").length;

  const levelMap = countBy(events, e => e.level);
  const byLevel  = Object.entries(levelMap).sort((a, b) => b[1] - a[1])
    .map(([level, count]) => ({ level, count: String(count) }));

  const errorMsgs = countBy(events.filter(e => e.level === "Error"), e => e.message);
  const topErrors = topN(errorMsgs, 10).map(([message, count]) => ({ message, count: String(count) }));

  const userMap  = countBy(events, e => e.user_id);
  const topUsers = topN(userMap, 10).map(([user_id, count]) => ({ user_id, count: String(count) }));

  const serviceMap  = countBy(events.filter(e => e.service), e => e.service);
  const topServices = topN(serviceMap, 10).map(([service, count]) => ({ service, count: String(count) }));

  return { total, errors, byLevel, topErrors, topUsers, topServices };
});

// ── getTimeline ───────────────────────────────────────────────────────────────

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

// ── getAuthErrorStats ─────────────────────────────────────────────────────────

export const getAuthErrorStats = createServerFn({ method: "GET" }).handler(async () =>
  memoizeSeq("getAuthErrorStats", async () => {
  const auth = await fetchSeq({
    filter:   "Contains(@Message, 'Erro autenticação')",
    maxTotal: 10000,
  });

  const tlMap: Record<string, { count: number; users: Set<string> }> = {};
  for (const e of auth) {
    const h  = truncHour(e.timestamp);
    if (!tlMap[h]) tlMap[h] = { count: 0, users: new Set() };
    tlMap[h].count++;
    const em = emailFrom(e.message || "");
    if (em) tlMap[h].users.add(em);
  }
  const timeline = Object.keys(tlMap).sort().map(h => ({
    hour: h, count: String(tlMap[h].count), unique_users: String(tlMap[h].users.size),
  }));

  const userAgg: Record<string, { count: number; last_seen: string }> = {};
  for (const e of auth) {
    const em = emailFrom(e.message || "");
    if (!em) continue;
    if (!userAgg[em]) userAgg[em] = { count: 0, last_seen: e.timestamp };
    userAgg[em].count++;
    if (e.timestamp > userAgg[em].last_seen) userAgg[em].last_seen = e.timestamp;
  }
  const topUsers = topN(countBy(auth, e => emailFrom(e.message || "")), 20)
    .map(([email]) => ({
      email,
      count:     String(userAgg[email]?.count ?? 0),
      last_seen: userAgg[email]?.last_seen ?? "",
    }));

  const topClients = topN(countBy(auth, e => clientFrom(e.message || "")), 10)
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
}));

// ── getKongAuthStats ──────────────────────────────────────────────────────────

export const getKongAuthStats = createServerFn({ method: "GET" }).handler(async () =>
  memoizeSeq("getKongAuthStats", async () => {
  const kongAll = await fetchSeq({
    filter:   "@Message = 'Kong Auth Request'",
    maxTotal: 10000,
  });
  const kongFail = kongAll.filter(e => Number(prop(e, "StatusCode")) !== 200);

  const total     = kongAll.length;
  const failures  = kongFail.length;
  const successes = kongAll.filter(e => Number(prop(e, "StatusCode")) === 200).length;
  const fail401   = kongFail.filter(e => Number(prop(e, "StatusCode")) === 401).length;
  const fail500   = kongFail.filter(e => Number(prop(e, "StatusCode")) === 500).length;

  const tlMap: Record<string, { f: number; s: number }> = {};
  for (const e of kongAll) {
    const h = truncHour(e.timestamp);
    if (!tlMap[h]) tlMap[h] = { f: 0, s: 0 };
    Number(prop(e, "StatusCode")) === 200 ? tlMap[h].s++ : tlMap[h].f++;
  }
  const timeline = Object.keys(tlMap).sort().map(h => ({
    hora: h, falhas: tlMap[h].f, sucessos: tlMap[h].s,
  }));

  const userAgg: Record<string, { falhas: number; first: string; last: string }> = {};
  for (const e of kongFail) {
    const u = prop(e, "Username") || "";
    if (!u) continue;
    if (!userAgg[u]) userAgg[u] = { falhas: 0, first: e.timestamp, last: e.timestamp };
    userAgg[u].falhas++;
    if (e.timestamp < userAgg[u].first) userAgg[u].first = e.timestamp;
    if (e.timestamp > userAgg[u].last)  userAgg[u].last  = e.timestamp;
  }
  const topUsers = Object.entries(userAgg)
    .sort((a, b) => b[1].falhas - a[1].falhas).slice(0, 20)
    .map(([username, v]) => ({
      username, falhas: String(v.falhas), first_seen: v.first, last_seen: v.last,
    }));

  const ipAgg: Record<string, { falhas: number; users: Set<string>; first: string; last: string }> = {};
  for (const e of kongFail) {
    const ip = prop(e, "ClientIP") || "";
    if (!ip) continue;
    if (!ipAgg[ip]) ipAgg[ip] = { falhas: 0, users: new Set(), first: e.timestamp, last: e.timestamp };
    ipAgg[ip].falhas++;
    const u = prop(e, "Username");
    if (u) ipAgg[ip].users.add(u);
    if (e.timestamp < ipAgg[ip].first) ipAgg[ip].first = e.timestamp;
    if (e.timestamp > ipAgg[ip].last)  ipAgg[ip].last  = e.timestamp;
  }
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

  const emailRe = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  const anonAgg: Record<string, { count: number; ips: Set<string> }> = {};
  for (const e of kongFail) {
    const u = prop(e, "Username") || "";
    if (!u || emailRe.test(u)) continue;
    if (!anonAgg[u]) anonAgg[u] = { count: 0, ips: new Set() };
    anonAgg[u].count++;
    const ip = prop(e, "ClientIP");
    if (ip) anonAgg[u].ips.add(ip);
  }
  const anomalousUsernames = Object.entries(anonAgg)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([username, v]) => ({
      username, client_ip: [...v.ips].join(", "), tentativas: String(v.count),
    }));

  const serverErrors = kongFail
    .filter(e => Number(prop(e, "StatusCode")) === 500)
    .map(e => ({
      timestamp: e.timestamp, username: prop(e, "Username"),
      client_ip: prop(e, "ClientIP"), path: prop(e, "Path"),
    }));

  const recentFailures = kongFail.slice(0, 50).map((e, i) => ({
    id: i, timestamp: e.timestamp, username: prop(e, "Username"),
    client_ip: prop(e, "ClientIP"), path: prop(e, "Path"),
    status_code: Number(prop(e, "StatusCode")), module: prop(e, "Module"),
  }));

  return {
    summary: {
      total, failures, successes, failures401: fail401, failures500: fail500,
      failurePct: total > 0 ? parseFloat((failures / total * 100).toFixed(1)) : 0,
    },
    timeline, topUsers, topIPs, credentialStuffing: stuffing,
    anomalousUsernames, serverErrors, recentFailures,
  };
}));
