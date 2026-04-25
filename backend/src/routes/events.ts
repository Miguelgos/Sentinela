import { Router, Request, Response } from "express";
import { query } from "../db";
import { EventFilters, EMPTY_GUID, parseSeqEvent, RawSeqEvent } from "../types";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const filters: EventFilters = {
    level: req.query.level as string,
    service: req.query.service as string,
    userId: req.query.userId as string,
    guidCotacao: req.query.guidCotacao as string,
    requestPath: req.query.requestPath as string,
    search: req.query.search as string,
    startDate: req.query.startDate as string,
    endDate: req.query.endDate as string,
    page: parseInt(req.query.page as string) || 1,
    pageSize: parseInt(req.query.pageSize as string) || 50,
    emptyGuidOnly: req.query.emptyGuidOnly === "true",
  };

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.level) {
    conditions.push(`level = $${paramIndex++}`);
    params.push(filters.level);
  }
  if (filters.service) {
    conditions.push(`service = $${paramIndex++}`);
    params.push(filters.service);
  }
  if (filters.userId) {
    conditions.push(`user_id = $${paramIndex++}`);
    params.push(filters.userId);
  }
  if (filters.emptyGuidOnly) {
    conditions.push(`guid_cotacao = $${paramIndex++}`);
    params.push(EMPTY_GUID);
  } else if (filters.guidCotacao) {
    conditions.push(`guid_cotacao = $${paramIndex++}`);
    params.push(filters.guidCotacao);
  }
  if (filters.requestPath) {
    conditions.push(`request_path ILIKE $${paramIndex++}`);
    params.push(`%${filters.requestPath}%`);
  }
  if (filters.search) {
    conditions.push(`message ILIKE $${paramIndex++}`);
    params.push(`%${filters.search}%`);
  }
  if (filters.startDate) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    params.push(filters.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = ((filters.page || 1) - 1) * (filters.pageSize || 50);

  const countResult = await query(
    `SELECT COUNT(*) FROM seq_events ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  const dataResult = await query(
    `SELECT id, event_id, timestamp, message, level, trace_id, user_id, guid_cotacao, service, environment, request_path, source_context, raw_data, created_at
     FROM seq_events ${where}
     ORDER BY timestamp DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, filters.pageSize || 50, offset]
  );

  res.json({
    data: dataResult.rows,
    total,
    page: filters.page || 1,
    pageSize: filters.pageSize || 50,
    totalPages: Math.ceil(total / (filters.pageSize || 50)),
  });
});

const STATS_WINDOW = `timestamp >= NOW() - INTERVAL '4 hours'`;

router.get("/stats/summary", async (_req: Request, res: Response) => {
  const [byLevel, topErrors, topUsers, guidBreakdown, topServices] =
    await Promise.all([
      query(
        `SELECT level, COUNT(*) as count FROM seq_events WHERE ${STATS_WINDOW} GROUP BY level ORDER BY count DESC`
      ),
      query(
        `SELECT message, COUNT(*) as count FROM seq_events WHERE level = 'Error' AND ${STATS_WINDOW}
         GROUP BY message ORDER BY count DESC LIMIT 10`
      ),
      query(
        `SELECT user_id, COUNT(*) as count FROM seq_events WHERE user_id IS NOT NULL AND ${STATS_WINDOW}
         GROUP BY user_id ORDER BY count DESC LIMIT 10`
      ),
      query(
        `SELECT
           SUM(CASE WHEN guid_cotacao = $1 THEN 1 ELSE 0 END) as empty_guid,
           SUM(CASE WHEN guid_cotacao IS NOT NULL AND guid_cotacao != $1 THEN 1 ELSE 0 END) as valid_guid,
           SUM(CASE WHEN guid_cotacao IS NULL THEN 1 ELSE 0 END) as no_guid,
           COUNT(*) as total_with_cotacao
         FROM seq_events WHERE (request_path ILIKE '%PrintItens%' OR guid_cotacao IS NOT NULL) AND ${STATS_WINDOW}`,
        [EMPTY_GUID]
      ),
      query(
        `SELECT service, COUNT(*) as count FROM seq_events WHERE service IS NOT NULL AND ${STATS_WINDOW}
         GROUP BY service ORDER BY count DESC LIMIT 10`
      ),
    ]);

  const totalResult = await query(`SELECT COUNT(*) FROM seq_events WHERE ${STATS_WINDOW}`);
  const errorResult = await query(
    `SELECT COUNT(*) FROM seq_events WHERE level = 'Error' AND ${STATS_WINDOW}`
  );

  res.json({
    total: parseInt(totalResult.rows[0].count),
    errors: parseInt(errorResult.rows[0].count),
    byLevel: byLevel.rows,
    topErrors: topErrors.rows,
    topUsers: topUsers.rows,
    guidBreakdown: guidBreakdown.rows[0],
    topServices: topServices.rows,
  });
});

router.get("/stats/timeline", async (req: Request, res: Response) => {
  const hours = parseInt(req.query.hours as string) || 24;
  const result = await query(
    `SELECT
       date_trunc('hour', timestamp) as hour,
       level,
       COUNT(*) as count
     FROM seq_events
     WHERE timestamp >= NOW() - INTERVAL '${hours} hours'
     GROUP BY hour, level
     ORDER BY hour ASC`
  );
  res.json(result.rows);
});

router.get("/stats/empty-guid-timeline", async (_req: Request, res: Response) => {
  const result = await query(
    `SELECT
       date_trunc('hour', timestamp) as hour,
       COUNT(*) as count,
       COUNT(DISTINCT user_id) as unique_users
     FROM seq_events
     WHERE guid_cotacao = $1 AND ${STATS_WINDOW}
     GROUP BY hour
     ORDER BY hour ASC`,
    [EMPTY_GUID]
  );
  res.json(result.rows);
});

router.get("/stats/auth-errors", async (_req: Request, res: Response) => {
  const WHERE = `message ILIKE '%Erro autenticação%' AND ${STATS_WINDOW}`;

  const [totalRes, timelineRes, topUsersRes, topClientsRes, recentRes] = await Promise.all([
    query(`SELECT COUNT(*) FROM seq_events WHERE ${WHERE}`),
    query(`
      SELECT
        date_trunc('hour', timestamp) AS hour,
        COUNT(*) AS count,
        COUNT(DISTINCT (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1]) AS unique_users
      FROM seq_events
      WHERE ${WHERE}
      GROUP BY hour
      ORDER BY hour ASC
    `),
    query(`
      SELECT
        (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1] AS email,
        COUNT(*) AS count,
        MAX(timestamp) AS last_seen
      FROM seq_events
      WHERE ${WHERE}
      GROUP BY (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1]
      HAVING (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1] IS NOT NULL
      ORDER BY count DESC
      LIMIT 20
    `),
    query(`
      SELECT
        (regexp_match(message, 'ClientId:\\s*(\\S+)\\s*\\|'))[1] AS client_id,
        COUNT(*) AS count
      FROM seq_events
      WHERE ${WHERE}
      GROUP BY (regexp_match(message, 'ClientId:\\s*(\\S+)\\s*\\|'))[1]
      HAVING (regexp_match(message, 'ClientId:\\s*(\\S+)\\s*\\|'))[1] IS NOT NULL
      ORDER BY count DESC
      LIMIT 10
    `),
    query(`
      SELECT id, event_id, timestamp, message, level, trace_id, request_path
      FROM seq_events
      WHERE ${WHERE}
      ORDER BY timestamp DESC
      LIMIT 100
    `),
  ]);

  res.json({
    total: parseInt(totalRes.rows[0].count),
    timeline: timelineRes.rows,
    topUsers: topUsersRes.rows,
    topClients: topClientsRes.rows,
    recentEvents: recentRes.rows,
  });
});

router.get("/stats/kong-auth", async (_req: Request, res: Response) => {
  const KONG_BASE = `message = 'Kong Auth Request'`;

  const extractProp = (name: string, cast = "") =>
    `(SELECT (elem->>'Value')${cast} FROM jsonb_array_elements(raw_data->'Properties') elem WHERE elem->>'Name' = '${name}')`;

  const statusCode = extractProp("StatusCode", "::int");
  const username   = extractProp("Username");
  const clientIp   = extractProp("ClientIP");
  const path       = extractProp("Path");
  const module_    = extractProp("Module");

  const CTE = `
    WITH kong AS (
      SELECT
        id, timestamp,
        ${statusCode} AS status_code,
        ${username}   AS username,
        ${clientIp}   AS client_ip,
        ${path}       AS path,
        ${module_}    AS module
      FROM seq_events
      WHERE ${KONG_BASE}
    ),
    kong_fail AS (SELECT * FROM kong WHERE status_code != 200)
  `;

  const [
    summaryRes,
    timelineRes,
    topUsersRes,
    topIPsRes,
    stuffingRes,
    anomalousRes,
    serverErrorsRes,
    recentRes,
  ] = await Promise.all([
    query(`${CTE}
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status_code != 200 THEN 1 ELSE 0 END) AS failures,
        SUM(CASE WHEN status_code = 200  THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN status_code = 401  THEN 1 ELSE 0 END) AS failures_401,
        SUM(CASE WHEN status_code = 500  THEN 1 ELSE 0 END) AS failures_500
      FROM kong`),

    query(`${CTE}
      SELECT
        date_trunc('hour', timestamp) AS hora,
        SUM(CASE WHEN status_code != 200 THEN 1 ELSE 0 END) AS falhas,
        SUM(CASE WHEN status_code = 200  THEN 1 ELSE 0 END) AS sucessos
      FROM kong GROUP BY hora ORDER BY hora ASC`),

    query(`${CTE}
      SELECT username, COUNT(*) AS falhas, MIN(timestamp) AS first_seen, MAX(timestamp) AS last_seen
      FROM kong_fail WHERE username IS NOT NULL
      GROUP BY username ORDER BY falhas DESC LIMIT 20`),

    query(`${CTE}
      SELECT client_ip,
        COUNT(*) AS falhas,
        COUNT(DISTINCT username) AS usuarios_unicos,
        MIN(timestamp) AS first_seen,
        MAX(timestamp) AS last_seen
      FROM kong_fail WHERE client_ip IS NOT NULL
      GROUP BY client_ip ORDER BY falhas DESC LIMIT 15`),

    query(`${CTE}
      SELECT client_ip,
        COUNT(DISTINCT username) AS usuarios_tentados,
        COUNT(*) AS total_falhas,
        ROUND(EXTRACT(EPOCH FROM (MAX(timestamp)-MIN(timestamp)))/60.0,1) AS janela_min,
        MIN(timestamp) AS first_seen,
        MAX(timestamp) AS last_seen
      FROM kong_fail WHERE client_ip IS NOT NULL
      GROUP BY client_ip
      HAVING COUNT(DISTINCT username) >= 3
      ORDER BY usuarios_tentados DESC`),

    query(`${CTE}
      SELECT username, client_ip, COUNT(*) AS tentativas
      FROM kong_fail
      WHERE username IS NOT NULL
        AND username !~ '^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$'
      GROUP BY username, client_ip ORDER BY tentativas DESC`),

    query(`${CTE}
      SELECT timestamp, username, client_ip, path
      FROM kong_fail WHERE status_code = 500
      ORDER BY timestamp DESC`),

    query(`${CTE}
      SELECT id, timestamp, username, client_ip, path, status_code, module
      FROM kong_fail ORDER BY timestamp DESC LIMIT 50`),
  ]);

  const s = summaryRes.rows[0];
  const total   = parseInt(s.total   || "0");
  const failures = parseInt(s.failures || "0");

  res.json({
    summary: {
      total,
      failures,
      successes: parseInt(s.successes    || "0"),
      failures401: parseInt(s.failures_401 || "0"),
      failures500: parseInt(s.failures_500 || "0"),
      failurePct: total > 0 ? parseFloat((failures / total * 100).toFixed(1)) : 0,
    },
    timeline: timelineRes.rows.map((r) => ({
      hora: r.hora,
      falhas: parseInt(r.falhas),
      sucessos: parseInt(r.sucessos),
    })),
    topUsers: topUsersRes.rows,
    topIPs: topIPsRes.rows,
    credentialStuffing: stuffingRes.rows,
    anomalousUsernames: anomalousRes.rows,
    serverErrors: serverErrorsRes.rows,
    recentFailures: recentRes.rows,
  });
});

router.get("/stats/security", async (_req: Request, res: Response) => {
  const AUTH_FILTER = `message ILIKE '%Erro autenticação%' AND ${STATS_WINDOW}`;

  const [
    totalAuthRes,
    bruteForceRes,
    anomalousUsernameRes,
    endpointBreakdownRes,
    criticalRes,
    onlyEmptyGuidRes,
    swaggerEvidenceRes,
    stackTraceEndpointsRes,
    jwtInLogsRes,
    expiredCertRes,
    dataProtectionRes,
    forwardedHeadersRes,
    efClientEvalRes,
    hangfireRes,
    vehicleIpRes,
    slowQueriesRes,
  ] = await Promise.all([
    // Auth failures per endpoint+client
    query(`
      SELECT
        request_path,
        (regexp_match(message, 'ClientId:\\s*(\\S+)\\s*[\\|$]'))[1] AS client_id,
        COUNT(*) AS failures,
        COUNT(DISTINCT (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1]) AS unique_users
      FROM seq_events
      WHERE ${AUTH_FILTER}
      GROUP BY request_path, (regexp_match(message, 'ClientId:\\s*(\\S+)\\s*[\\|$]'))[1]
      ORDER BY failures DESC
    `),
    // Brute force: >=3 failures in <5 min
    query(`
      SELECT
        (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1] AS username,
        COUNT(*) AS attempts,
        ROUND(EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60.0, 1) AS window_minutes,
        ROUND(COUNT(*) / NULLIF(EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60.0, 0), 1) AS rate_per_min,
        MIN(timestamp) AS first_seen,
        MAX(timestamp) AS last_seen
      FROM seq_events
      WHERE ${AUTH_FILTER}
      GROUP BY (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1]
      HAVING COUNT(*) >= 3
        AND EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) < 300
        AND (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1] IS NOT NULL
      ORDER BY rate_per_min DESC NULLS LAST
      LIMIT 20
    `),
    // Non-email usernames
    query(`
      SELECT DISTINCT
        (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1] AS username,
        COUNT(*) OVER (PARTITION BY (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1]) AS attempts
      FROM seq_events
      WHERE ${AUTH_FILTER}
        AND (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1] IS NOT NULL
        AND (regexp_match(message, 'User:\\s*(\\S+)\\s*\\|'))[1] !~ '^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$'
      ORDER BY attempts DESC
    `),
    // Top endpoints by error count
    query(`
      SELECT request_path, level, COUNT(*) AS count
      FROM seq_events
      WHERE level IN ('Error', 'Critical') AND request_path IS NOT NULL AND ${STATS_WINDOW}
      GROUP BY request_path, level
      ORDER BY count DESC
      LIMIT 15
    `),
    // Critical unhandled exceptions
    query(`
      SELECT source_context, COUNT(*) AS count, MAX(timestamp) AS last_seen
      FROM seq_events
      WHERE level = 'Critical' AND ${STATS_WINDOW}
      GROUP BY source_context
      ORDER BY count DESC
    `),
    // Users with 100% empty GUID
    query(`
      SELECT user_id, COUNT(*) AS empty_guid_calls
      FROM seq_events
      WHERE guid_cotacao = $1 AND user_id IS NOT NULL AND ${STATS_WINDOW}
      GROUP BY user_id
      HAVING user_id NOT IN (
        SELECT DISTINCT user_id FROM seq_events
        WHERE guid_cotacao IS NOT NULL AND guid_cotacao != $1 AND user_id IS NOT NULL AND ${STATS_WINDOW}
      )
      ORDER BY empty_guid_calls DESC
      LIMIT 10
    `, [EMPTY_GUID]),
    // Swagger in production
    query(`
      SELECT COUNT(*) AS count FROM seq_events
      WHERE (message ILIKE '%SwaggerMiddleware%' OR message ILIKE '%SwaggerUI%') AND ${STATS_WINDOW}
    `),
    // Stack traces exposed
    query(`
      SELECT request_path, COUNT(*) AS count
      FROM seq_events
      WHERE (message ILIKE '%   at %' OR message ILIKE '%stack trace%')
        AND request_path IS NOT NULL AND level IN ('Error', 'Critical') AND ${STATS_WINDOW}
      GROUP BY request_path
      ORDER BY count DESC
      LIMIT 10
    `),
    // JWT tokens logged in plain text
    query(`
      SELECT
        COUNT(*) AS total_occurrences,
        COUNT(DISTINCT (regexp_match(message, 'TokenRecebido:\\s*(\\S+)'))[1]) AS unique_tokens,
        MIN(timestamp) AS first_seen,
        MAX(timestamp) AS last_seen
      FROM seq_events
      WHERE message ILIKE '%TokenRecebido%' AND ${STATS_WINDOW}
    `),
    // Expired SSL certificate warnings
    query(`
      SELECT
        COUNT(*) AS count,
        (regexp_match(message, 'Certificate ([^h]+) has expired'))[1] AS cert_name,
        (regexp_match(message, 'expired on (.+)'))[1] AS expired_on,
        MIN(timestamp) AS first_seen,
        MAX(timestamp) AS last_seen
      FROM seq_events
      WHERE message ILIKE '%Certificate%expired%' AND ${STATS_WINDOW}
      GROUP BY cert_name, expired_on
    `),
    // DataProtection keys without encryption
    query(`
      SELECT COUNT(*) AS count, MAX(timestamp) AS last_seen
      FROM seq_events
      WHERE source_context ILIKE '%DataProtection%'
        AND message ILIKE '%unencrypted%' AND ${STATS_WINDOW}
    `),
    // ForwardedHeaders mismatch (IP spoofing risk)
    query(`
      SELECT COUNT(*) AS count
      FROM seq_events
      WHERE source_context ILIKE '%ForwardedHeaders%' AND level = 'Warning' AND ${STATS_WINDOW}
    `),
    // EF Core client-side evaluation
    query(`
      SELECT
        SUM(CASE WHEN message ILIKE '%evaluated locally%' THEN 1 ELSE 0 END) AS local_eval,
        SUM(CASE WHEN message ILIKE '%without OrderBy%' THEN 1 ELSE 0 END) AS no_order_by
      FROM seq_events
      WHERE source_context = 'Microsoft.EntityFrameworkCore.Query' AND level = 'Warning' AND ${STATS_WINDOW}
    `),
    // Hangfire failing jobs
    query(`
      SELECT message, COUNT(*) AS count, MAX(timestamp) AS last_seen
      FROM seq_events
      WHERE source_context ILIKE '%Hangfire%' AND level != 'Information' AND ${STATS_WINDOW}
      GROUP BY message
      ORDER BY count DESC
      LIMIT 10
    `),
    // Unique vehicle IPs in logs (PocSag — privacy/LGPD)
    query(`
      SELECT COUNT(DISTINCT (regexp_match(message, 'PocSag\\s*:\\s*([0-9.]+)'))[1]) AS unique_ips
      FROM seq_events WHERE message ILIKE '%PocSag%' AND ${STATS_WINDOW}
    `),
    // Slow DB queries (> 500ms)
    query(`
      SELECT COUNT(*) AS count,
        MAX((regexp_match(message, '(\\d+)ms'))[1]::int) AS max_ms
      FROM seq_events
      WHERE source_context = 'Microsoft.EntityFrameworkCore.Database.Command'
        AND message ~ '\\d+ms'
        AND (regexp_match(message, '(\\d+)ms'))[1]::int > 500
        AND ${STATS_WINDOW}
    `),
  ]);

  res.json({
    authByEndpoint: totalAuthRes.rows,
    bruteForce: bruteForceRes.rows,
    anomalousUsernames: anomalousUsernameRes.rows,
    topErrorEndpoints: endpointBreakdownRes.rows,
    criticalByContext: criticalRes.rows,
    onlyEmptyGuidUsers: onlyEmptyGuidRes.rows,
    swaggerEvidence: parseInt(swaggerEvidenceRes.rows[0]?.count || "0"),
    stackTraceEndpoints: stackTraceEndpointsRes.rows,
    jwtInLogs: {
      total: parseInt(jwtInLogsRes.rows[0]?.total_occurrences || "0"),
      uniqueTokens: parseInt(jwtInLogsRes.rows[0]?.unique_tokens || "0"),
      firstSeen: jwtInLogsRes.rows[0]?.first_seen || null,
      lastSeen: jwtInLogsRes.rows[0]?.last_seen || null,
    },
    expiredCerts: expiredCertRes.rows,
    dataProtectionUnencrypted: parseInt(dataProtectionRes.rows[0]?.count || "0"),
    forwardedHeadersMismatch: parseInt(forwardedHeadersRes.rows[0]?.count || "0"),
    efClientEval: {
      localEval: parseInt(efClientEvalRes.rows[0]?.local_eval || "0"),
      noOrderBy: parseInt(efClientEvalRes.rows[0]?.no_order_by || "0"),
    },
    hangfireFailures: hangfireRes.rows,
    vehicleIpsExposed: parseInt(vehicleIpRes.rows[0]?.unique_ips || "0"),
    slowQueries: {
      count: parseInt(slowQueriesRes.rows[0]?.count || "0"),
      maxMs: parseInt(slowQueriesRes.rows[0]?.max_ms || "0"),
    },
  });
});

router.get("/:id", async (req: Request, res: Response) => {
  const result = await query(
    `SELECT * FROM seq_events WHERE id = $1`,
    [req.params.id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Evento não encontrado" });
    return;
  }
  res.json(result.rows[0]);
});

router.delete("/", async (_req: Request, res: Response) => {
  await query(`DELETE FROM seq_events`);
  res.json({ message: "Todos os eventos foram removidos" });
});

router.post("/import", async (req: Request, res: Response) => {
  const events: RawSeqEvent[] = req.body;
  if (!Array.isArray(events)) {
    res.status(400).json({ error: "Body deve ser um array de eventos" });
    return;
  }

  let imported = 0;
  let skipped = 0;

  for (const raw of events) {
    const parsed = parseSeqEvent(raw);
    try {
      await query(
        `INSERT INTO seq_events (event_id, timestamp, message_template, message, level, trace_id, span_id, user_id, guid_cotacao, service, environment, request_path, source_context, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          parsed.event_id,
          parsed.timestamp,
          parsed.message_template,
          parsed.message,
          parsed.level,
          parsed.trace_id,
          parsed.span_id,
          parsed.user_id,
          parsed.guid_cotacao,
          parsed.service,
          parsed.environment,
          parsed.request_path,
          parsed.source_context,
          JSON.stringify(parsed.raw_data),
        ]
      );
      imported++;
    } catch {
      skipped++;
    }
  }

  res.json({ imported, skipped, total: events.length });
});

router.post("/sample", async (_req: Request, res: Response) => {
  const levels = ["Error", "Error", "Error", "Warning", "Information"];
  const users = ["1348383", "1348384", "1348385", "1348386", "1348387", "1348388"];
  const guids = [
    EMPTY_GUID,
    EMPTY_GUID,
    EMPTY_GUID,
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  ];

  let imported = 0;
  const now = new Date();

  for (let i = 0; i < 80; i++) {
    const level = levels[Math.floor(Math.random() * levels.length)];
    const userId = users[Math.floor(Math.random() * users.length)];
    const guidCotacao = guids[Math.floor(Math.random() * guids.length)];
    const isError = level === "Error";
    const ts = new Date(now.getTime() - Math.random() * 24 * 60 * 60 * 1000);

    const raw: RawSeqEvent = {
      "@t": ts.toISOString(),
      "@mt": isError
        ? `[salesbo-66cb5b49c6-vgtg5] [Ituran.Integra.Sales.Backoffice] Quote | GetPdfItemsToPrint | Quote/PrintItens | UserId: ${userId} | GUID_COTACAO: ${guidCotacao} | Error: Cotação não encontrada |    at Ituran.Integra.Sales.Backoffice.Features.Quote.GetPdfItemsToPrint.GetPdfItemsToPrintEndpoint.HandleAsync`
        : `[salesbo-66cb5b49c6-vgtg5] [Ituran.Integra.Sales.Backoffice] Quote | GetPdfItemsToPrint | Quote/PrintItens | UserId: ${userId} | GUID_COTACAO: ${guidCotacao} | Success`,
      "@i": `sample-${i}-${Date.now()}`,
      "@l": level,
      "@@tr": `trace${Math.random().toString(36).substring(7)}`,
      "@@sp": `span${Math.random().toString(36).substring(7)}`,
      SourceContext:
        "Ituran.Integra.Sales.Backoffice.Features.Quote.GetPdfItemsToPrint.GetPdfItemsToPrintEndpoint",
      dd_service: "salesbo",
      dd_env: "integra-prd",
      RequestPath: "/Quote/PrintItens",
    };
    raw["@m"] = raw["@mt"];

    const parsed = parseSeqEvent(raw);
    try {
      await query(
        `INSERT INTO seq_events (event_id, timestamp, message_template, message, level, trace_id, span_id, user_id, guid_cotacao, service, environment, request_path, source_context, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          parsed.event_id,
          parsed.timestamp,
          parsed.message_template,
          parsed.message,
          parsed.level,
          parsed.trace_id,
          parsed.span_id,
          parsed.user_id,
          parsed.guid_cotacao,
          parsed.service,
          parsed.environment,
          parsed.request_path,
          parsed.source_context,
          JSON.stringify(parsed.raw_data),
        ]
      );
      imported++;
    } catch {
      // skip duplicates
    }
  }

  res.json({ imported, message: `${imported} eventos de exemplo criados` });
});

export default router;
