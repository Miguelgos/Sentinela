import { Router, Request, Response } from "express";
import { fetchSeq, prop, truncHour, ParsedEvent } from "../seq";
import { getEvents, isReady, storeSize, storeCoverage } from "../accumulator";
import { EMPTY_GUID } from "../types";

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function toEvent(e: ParsedEvent, idx: number) {
  return {
    id: e.event_id || String(idx),
    event_id: e.event_id,
    timestamp: e.timestamp,
    message: e.message,
    level: e.level,
    trace_id: e.trace_id,
    user_id: e.user_id,
    guid_cotacao: e.guid_cotacao,
    service: e.service,
    environment: e.environment,
    request_path: e.request_path,
    source_context: e.source_context,
    raw_data: e.raw_data,
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

// ── GET /stats/status ─────────────────────────────────────────────────────────
router.get("/stats/status", (_req: Request, res: Response) => {
  const { oldest, newest } = storeCoverage();
  res.json({ ready: isReady(), events: storeSize(), oldest, newest });
});

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get("/", (req: Request, res: Response) => {
  const level       = req.query.level as string | undefined;
  const search      = (req.query.search as string || "").toLowerCase();
  const emptyGuidOnly = req.query.emptyGuidOnly === "true";
  const page        = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize    = Math.min(200, parseInt(req.query.pageSize as string) || 50);

  let events = getEvents();
  if (level)         events = events.filter(e => e.level === level);
  if (emptyGuidOnly) events = events.filter(e => e.guid_cotacao === EMPTY_GUID);
  if (search)        events = events.filter(e => e.message?.toLowerCase().includes(search));

  const total      = events.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const slice      = events.slice((page - 1) * pageSize, page * pageSize);

  res.json({ data: slice.map(toEvent), total, page, pageSize, totalPages });
});

// ── GET /stats/summary ────────────────────────────────────────────────────────
router.get("/stats/summary", (_req: Request, res: Response) => {
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

  const relevant   = events.filter(e => e.guid_cotacao != null || e.request_path?.toLowerCase().includes("printitens") || e.request_path?.toLowerCase().includes("quote"));
  const empty_guid = relevant.filter(e => e.guid_cotacao === EMPTY_GUID).length;
  const valid_guid = relevant.filter(e => e.guid_cotacao && e.guid_cotacao !== EMPTY_GUID).length;
  const no_guid    = relevant.filter(e => !e.guid_cotacao).length;

  res.json({
    total, errors, byLevel, topErrors, topUsers, topServices,
    guidBreakdown: {
      empty_guid: String(empty_guid),
      valid_guid: String(valid_guid),
      no_guid: String(no_guid),
      total_with_cotacao: String(relevant.length),
    },
  });
});

// ── GET /stats/timeline ───────────────────────────────────────────────────────
router.get("/stats/timeline", (req: Request, res: Response) => {
  const hours    = Math.min(168, parseInt(req.query.hours as string) || 24);
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
  res.json(result);
});

// ── GET /stats/empty-guid-timeline ───────────────────────────────────────────
// Filtered fetch: vai direto ao Seq pedindo só eventos com GuidQuote
router.get("/stats/empty-guid-timeline", async (_req: Request, res: Response) => {
  try {
    const events = await fetchSeq({
      filter:   "RequestPath = '/Quote/GetSimpleQuote'",
      maxTotal: 10000,
    });
    const empty = events.filter(e => e.guid_cotacao === EMPTY_GUID);

    const map: Record<string, { count: number; users: Set<string> }> = {};
    for (const e of empty) {
      const h = truncHour(e.timestamp);
      if (!map[h]) map[h] = { count: 0, users: new Set() };
      map[h].count++;
      if (e.user_id) map[h].users.add(e.user_id);
    }

    res.json(Object.keys(map).sort().map(h => ({
      hour:         h,
      count:        String(map[h].count),
      unique_users: String(map[h].users.size),
    })));
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ── GET /stats/auth-errors ────────────────────────────────────────────────────
// Filtered fetch: só eventos de falha de autenticação
router.get("/stats/auth-errors", async (_req: Request, res: Response) => {
  try {
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

    res.json({ total: auth.length, timeline, topUsers, topClients, recentEvents });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ── GET /stats/kong-auth ──────────────────────────────────────────────────────
// Filtered fetch: só eventos Kong Auth Request
router.get("/stats/kong-auth", async (_req: Request, res: Response) => {
  try {
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

    res.json({
      summary: {
        total, failures, successes, failures401: fail401, failures500: fail500,
        failurePct: total > 0 ? parseFloat((failures / total * 100).toFixed(1)) : 0,
      },
      timeline, topUsers, topIPs, credentialStuffing: stuffing,
      anomalousUsernames, serverErrors, recentFailures,
    });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ── GET /stats/security ───────────────────────────────────────────────────────
// Usa o acumulador + fetch paralelo de auth errors para brute force histórico
router.get("/stats/security", async (_req: Request, res: Response) => {
  try {
    // Para análises que precisam de profundidade histórica, fetch com filtro
    const [accEvents, authFiltered] = await Promise.all([
      Promise.resolve(getEvents()),
      fetchSeq({ filter: "Contains(@Message, 'Erro autenticação')", maxTotal: 10000 }),
    ]);

    const authFails = authFiltered;
    const errors    = accEvents.filter(e => e.level === "Error" || e.level === "Critical");
    const criticals = accEvents.filter(e => e.level === "Critical");

    // 1. Auth failures by endpoint + client
    const epMap: Record<string, { failures: number; users: Set<string> }> = {};
    for (const e of authFails) {
      const key = `${e.request_path || ""}||${clientFrom(e.message || "") || ""}`;
      if (!epMap[key]) epMap[key] = { failures: 0, users: new Set() };
      epMap[key].failures++;
      const em = emailFrom(e.message || "");
      if (em) epMap[key].users.add(em);
    }
    const authByEndpoint = Object.entries(epMap)
      .sort((a, b) => b[1].failures - a[1].failures)
      .map(([key, v]) => {
        const [request_path, client_id] = key.split("||");
        return { request_path, client_id, failures: String(v.failures), unique_users: String(v.users.size) };
      });

    // 2. Brute force (histórico completo via filtro)
    const bfMap: Record<string, Date[]> = {};
    for (const e of authFails) {
      const u = emailFrom(e.message || "");
      if (!u) continue;
      if (!bfMap[u]) bfMap[u] = [];
      bfMap[u].push(new Date(e.timestamp));
    }
    const bruteForce = Object.entries(bfMap)
      .filter(([, ts]) => {
        if (ts.length < 3) return false;
        const sorted = ts.sort((a, b) => a.getTime() - b.getTime());
        return (sorted[sorted.length - 1].getTime() - sorted[0].getTime()) < 300_000;
      })
      .map(([username, ts]) => {
        const sorted = ts.sort((a, b) => a.getTime() - b.getTime());
        const ms = sorted[sorted.length - 1].getTime() - sorted[0].getTime();
        const winMin = ms / 60000;
        return {
          username, attempts: String(ts.length),
          window_minutes: String(winMin.toFixed(1)),
          rate_per_min: String(winMin > 0 ? (ts.length / winMin).toFixed(1) : "∞"),
          first_seen: sorted[0].toISOString(),
          last_seen: sorted[sorted.length - 1].toISOString(),
        };
      })
      .sort((a, b) => parseFloat(b.rate_per_min) - parseFloat(a.rate_per_min))
      .slice(0, 20);

    // 3. Anomalous usernames
    const emailRe = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    const anomMap = countBy(
      authFails.filter(e => { const u = emailFrom(e.message || ""); return u && !emailRe.test(u); }),
      e => emailFrom(e.message || "")
    );
    const anomalousUsernames = topN(anomMap, 50).map(([username, count]) => ({
      username, attempts: String(count),
    }));

    // 4. Top error endpoints
    const epErrMap: Record<string, number> = {};
    for (const e of errors) {
      if (!e.request_path) continue;
      const key = `${e.request_path}||${e.level}`;
      epErrMap[key] = (epErrMap[key] ?? 0) + 1;
    }
    const topErrorEndpoints = topN(epErrMap, 15).map(([key, count]) => {
      const [request_path, level] = key.split("||");
      return { request_path, level, count: String(count) };
    });

    // 5. Critical by source_context
    const ctxMap = countBy(criticals, e => e.source_context);
    const ctxLast: Record<string, string> = {};
    for (const e of criticals) { if (e.source_context) ctxLast[e.source_context] = e.timestamp; }
    const criticalByContext = topN(ctxMap, 20).map(([source_context, count]) => ({
      source_context, count: String(count), last_seen: ctxLast[source_context] ?? "",
    }));

    // 6. Users with only empty GUIDs
    const quoteEvents = accEvents.filter(e => e.guid_cotacao != null || e.request_path?.toLowerCase().includes("quote"));
    const emptyGuidUsers = new Set(quoteEvents.filter(e => e.guid_cotacao === EMPTY_GUID && e.user_id).map(e => e.user_id!));
    const validGuidUsers = new Set(quoteEvents.filter(e => e.guid_cotacao && e.guid_cotacao !== EMPTY_GUID && e.user_id).map(e => e.user_id!));
    const onlyEmptyGuidUsers = [...emptyGuidUsers]
      .filter(u => !validGuidUsers.has(u))
      .map(u => ({
        user_id: u,
        empty_guid_calls: String(quoteEvents.filter(e => e.user_id === u && e.guid_cotacao === EMPTY_GUID).length),
      }))
      .sort((a, b) => parseInt(b.empty_guid_calls) - parseInt(a.empty_guid_calls))
      .slice(0, 10);

    // 7. Swagger in production
    const swaggerEvidence = accEvents.filter(e =>
      e.message?.toLowerCase().includes("swaggermiddleware") || e.message?.toLowerCase().includes("swaggerui")
    ).length;

    // 8. Stack traces exposed
    const stackMap: Record<string, number> = {};
    for (const e of errors) {
      if (!e.request_path) continue;
      if (e.message?.includes("   at ") || e.message?.toLowerCase().includes("stack trace")) {
        stackMap[e.request_path] = (stackMap[e.request_path] ?? 0) + 1;
      }
    }
    const stackTraceEndpoints = topN(stackMap, 10).map(([request_path, count]) => ({
      request_path, count: String(count),
    }));

    // 9. JWT tokens in logs
    const jwtEvents = accEvents.filter(e => e.message?.includes("TokenRecebido"));
    const uniqueTokens = new Set(jwtEvents.map(e => e.message?.match(/TokenRecebido:\s*(\S+)/)?.[1]).filter(Boolean)).size;

    // 10. Expired certs
    const certEvents = accEvents.filter(e => e.message?.toLowerCase().includes("certificate") && e.message?.toLowerCase().includes("expired"));
    const certMap: Record<string, { count: number; name: string | null; expiredOn: string | null; first: string; last: string }> = {};
    for (const e of certEvents) {
      const certName = e.message?.match(/Certificate ([^h]+) has expired/)?.[1]?.trim() ?? null;
      const expOn    = e.message?.match(/expired on (.+)/)?.[1]?.trim() ?? null;
      const key = `${certName}||${expOn}`;
      if (!certMap[key]) certMap[key] = { count: 0, name: certName, expiredOn: expOn, first: e.timestamp, last: e.timestamp };
      certMap[key].count++;
      if (e.timestamp > certMap[key].last) certMap[key].last = e.timestamp;
    }
    const expiredCerts = Object.values(certMap).map(v => ({
      count: String(v.count), cert_name: v.name ?? "", expired_on: v.expiredOn ?? "",
      first_seen: v.first, last_seen: v.last,
    }));

    // 11–16. Infrastructure checks
    const dataProtectionUnencrypted = accEvents.filter(e =>
      e.source_context?.toLowerCase().includes("dataprotection") && e.message?.toLowerCase().includes("unencrypted")
    ).length;

    const forwardedHeadersMismatch = accEvents.filter(e =>
      e.source_context?.toLowerCase().includes("forwardedheaders") && e.level === "Warning"
    ).length;

    const efEvents = accEvents.filter(e => e.source_context === "Microsoft.EntityFrameworkCore.Query" && e.level === "Warning");
    const efClientEval = {
      localEval: efEvents.filter(e => e.message?.toLowerCase().includes("evaluated locally")).length,
      noOrderBy: efEvents.filter(e => e.message?.toLowerCase().includes("without orderby")).length,
    };

    const hangMap = countBy(
      accEvents.filter(e => e.source_context?.toLowerCase().includes("hangfire") && e.level !== "Information"),
      e => e.message
    );
    const hangLast: Record<string, string> = {};
    for (const e of accEvents.filter(e => e.source_context?.toLowerCase().includes("hangfire"))) {
      if (e.message) hangLast[e.message] = e.timestamp;
    }
    const hangfireFailures = topN(hangMap, 10).map(([message, count]) => ({
      message, count: String(count), last_seen: hangLast[message] ?? "",
    }));

    const vehicleIps = new Set(
      accEvents.flatMap(e => e.message?.match(/PocSag\s*:\s*([0-9.]+)/g)?.map(m => m.split(":").pop()?.trim()) ?? [])
        .filter(Boolean)
    );

    const dbEvents  = accEvents.filter(e => e.source_context === "Microsoft.EntityFrameworkCore.Database.Command" && e.message?.match(/\d+ms/));
    const slowEvents = dbEvents.filter(e => parseInt(e.message?.match(/(\d+)ms/)?.[1] ?? "0") > 500);
    const maxMs = slowEvents.reduce((m, e) => Math.max(m, parseInt(e.message?.match(/(\d+)ms/)?.[1] ?? "0")), 0);

    res.json({
      authByEndpoint, bruteForce, anomalousUsernames,
      topErrorEndpoints, criticalByContext, onlyEmptyGuidUsers,
      swaggerEvidence, stackTraceEndpoints,
      jwtInLogs: {
        total: jwtEvents.length, uniqueTokens,
        firstSeen: jwtEvents.at(-1)?.timestamp ?? null,
        lastSeen:  jwtEvents.at(0)?.timestamp ?? null,
      },
      expiredCerts, dataProtectionUnencrypted, forwardedHeadersMismatch, efClientEval,
      hangfireFailures, vehicleIpsExposed: vehicleIps.size,
      slowQueries: { count: slowEvents.length, maxMs },
    });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get("/:id", (req: Request, res: Response) => {
  const event = getEvents().find(e => e.event_id === req.params.id);
  if (!event) { res.status(404).json({ error: "Evento não encontrado" }); return; }
  res.json(toEvent(event, 0));
});

export default router;
