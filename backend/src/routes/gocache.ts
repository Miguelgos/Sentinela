import { Router } from "express";
import { gcFetch } from "../lib/gcClient";

const router = Router();

type GcResp = Record<string, unknown>;
type GcEvent = {
  id: string; host: string; domain: string; ip: string; method: string;
  uri: string; user_agent: string; timestamp: number; action: string;
  type: string; country_code: string; referer: string;
  alerts: { id: string; msg: string; match?: string; location?: string }[];
};

function eventsBody(types: string[], actions: string[], from: number, to: number, page = 1) {
  return { start_date: from, end_date: to, type: types, action: actions, limit: 100, page };
}

function parseEvents(raw: GcResp): GcEvent[] {
  return (((raw?.response as GcResp)?.events ?? []) as GcEvent[]);
}
function totalOf(raw: GcResp): number {
  return Number((raw?.response as GcResp)?.total ?? 0);
}
function pagesOf(raw: GcResp): number {
  return Number((raw?.response as GcResp)?.pages ?? 0);
}

/**
 * Paginates GoCache /v1/threat-hub/events up to `maxPages` (100/page),
 * returning the first page raw response (for totals) plus the merged events list.
 */
async function fetchAllGcEvents(
  types: string[],
  actions: string[],
  from: number,
  to: number,
  maxPages = 5,
): Promise<{ first: GcResp; events: GcEvent[] }> {
  const first = (await gcFetch(
    "/v1/threat-hub/events",
    "POST",
    eventsBody(types, actions, from, to, 1),
  )) as GcResp;

  const events = parseEvents(first);
  const totalPages = Math.min(pagesOf(first), maxPages);

  if (totalPages <= 1) return { first, events };

  const remaining = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      gcFetch(
        "/v1/threat-hub/events",
        "POST",
        eventsBody(types, actions, from, to, i + 2),
      ) as Promise<GcResp>,
    ),
  );

  for (const r of remaining) {
    events.push(...parseEvents(r));
  }
  return { first, events };
}

function classifyAlert(msg: string, id: string): string {
  const m = (msg || "").toLowerCase();
  const aid = id || "";
  if (m.includes("sql") || aid.startsWith("41")) return "SQL Injection";
  if (m.includes("xss") || m.includes("script") || m.includes("cross-site")) return "XSS / Script";
  if (m.includes("traversal") || m.includes("lfi") || m.includes("rfi") || m.includes("path")) return "Path Traversal";
  if (m.includes("scanner") || m.includes("probe") || m.includes("nikto") || m.includes("nmap")) return "Scanner/Probe";
  if (m.includes("accept") || m.includes("content-type") || m.includes("header") || m.includes("protocol")) return "Protocol/Header";
  return "Outros";
}

function detectTool(ua: string): string {
  if (!ua) return "Other";
  const lc = ua.toLowerCase();
  if (ua.includes("Dart") || ua.includes("dart")) return "Dart";
  if (ua.includes("Python") || ua.includes("python")) return "Python";
  if (lc.includes("curl")) return "curl";
  if (lc.includes("java") && !ua.includes("JavaScript")) return "Java";
  if (ua.includes("Go-http") || ua === "Go/1") return "Go";
  if (lc.includes("sqlmap")) return "SQLMap";
  if (lc.includes("nikto")) return "Nikto";
  if (ua.includes("HeadlessChrome") || ua.includes("PhantomJS")) return "Headless";
  if (lc.includes("mozilla")) return "Browser";
  return "Other";
}

// GET /api/gocache/overview
router.get("/overview", async (_req, res) => {
  const now  = Math.floor(Date.now() / 1000);
  const from = now - 86400; // last 24h

  try {
    const [domainsRaw, wafRes, botRes, firewallBlock, botSim] = await Promise.all([
      gcFetch("/v1/domain") as Promise<GcResp>,
      fetchAllGcEvents(["waf"],            ["block"],    from, now, 5),
      fetchAllGcEvents(["bot-mitigation"], ["block"],    from, now, 3),
      gcFetch("/v1/threat-hub/events", "POST", eventsBody(["firewall"],       ["block"],    from, now, 1)) as Promise<GcResp>,
      gcFetch("/v1/threat-hub/events", "POST", eventsBody(["bot-mitigation"], ["simulate"], from, now, 1)) as Promise<GcResp>,
    ]);

    const domains = ((domainsRaw?.response as GcResp)?.domains ?? []) as string[];

    const wafEvents      = wafRes.events;
    const botBlocked     = botRes.events;
    const firewallEvents = parseEvents(firewallBlock);
    const botSimulated   = parseEvents(botSim);

    const totals = {
      waf:      totalOf(wafRes.first),
      firewall: totalOf(firewallBlock),
      bot:      totalOf(botRes.first),
      botSim:   totalOf(botSim),
    };

    // Top IPs across all blocked events
    const ipCount: Record<string, number> = {};
    for (const ev of [...wafEvents, ...firewallEvents, ...botBlocked]) {
      ipCount[ev.ip] = (ipCount[ev.ip] ?? 0) + 1;
    }
    const topIPs = Object.entries(ipCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([ip, count]) => ({ ip, count }));

    // Top alert types from WAF
    const alertCount: Record<string, number> = {};
    for (const ev of wafEvents) {
      for (const a of ev.alerts) {
        alertCount[a.id] = (alertCount[a.id] ?? 0) + 1;
      }
    }
    const topAlerts = Object.entries(alertCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, count }));

    // Top attacked URIs
    const uriCount: Record<string, number> = {};
    for (const ev of [...wafEvents, ...botBlocked]) {
      const u = ev.uri?.split("?")[0] || "/";
      uriCount[u] = (uriCount[u] ?? 0) + 1;
    }
    const topURIs = Object.entries(uriCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([uri, count]) => ({ uri, count }));

    // Top attacked hosts
    const hostCount: Record<string, number> = {};
    for (const ev of [...wafEvents, ...firewallEvents, ...botBlocked]) {
      hostCount[ev.host] = (hostCount[ev.host] ?? 0) + 1;
    }
    const topHosts = Object.entries(hostCount)
      .sort((a, b) => b[1] - a[1])
      .map(([host, count]) => ({ host, count }));

    // ---- New analytics ----

    // Timeline: events per ISO hour for last 24h, by category
    const allClassified: { ts: number; cat: "waf" | "bot" | "firewall" }[] = [
      ...wafEvents.map((e)      => ({ ts: e.timestamp, cat: "waf" as const })),
      ...botBlocked.map((e)     => ({ ts: e.timestamp, cat: "bot" as const })),
      ...firewallEvents.map((e) => ({ ts: e.timestamp, cat: "firewall" as const })),
    ];
    const hourBuckets: Record<string, { waf: number; bot: number; firewall: number }> = {};
    for (const ev of allClassified) {
      if (!ev.ts) continue;
      const hour = new Date(ev.ts * 1000).toISOString().slice(0, 13) + ":00:00.000Z";
      if (!hourBuckets[hour]) hourBuckets[hour] = { waf: 0, bot: 0, firewall: 0 };
      hourBuckets[hour][ev.cat]++;
    }
    const timeline = Object.entries(hourBuckets)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([hour, c]) => ({ hour, waf: c.waf, bot: c.bot, firewall: c.firewall }));

    // Country breakdown — top 15
    const countryCount: Record<string, number> = {};
    for (const ev of [...wafEvents, ...botBlocked, ...firewallEvents]) {
      const c = ev.country_code || "??";
      countryCount[c] = (countryCount[c] ?? 0) + 1;
    }
    const byCountry = Object.entries(countryCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([country, count]) => ({ country, count }));

    // Attack categories from WAF alerts
    const catCount: Record<string, number> = {};
    for (const ev of wafEvents) {
      for (const a of ev.alerts) {
        const cat = classifyAlert(a.msg || "", a.id || "");
        catCount[cat] = (catCount[cat] ?? 0) + 1;
      }
    }
    const attackCategories = Object.entries(catCount)
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count }));

    // Bot types from bot events alerts[0].id
    const botTypeCount: Record<string, number> = {};
    for (const ev of botBlocked) {
      const t = ev.alerts?.[0]?.id || "unknown";
      botTypeCount[t] = (botTypeCount[t] ?? 0) + 1;
    }
    const botTypes = Object.entries(botTypeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));

    // User-Agent tools across WAF + bot events
    const toolCount: Record<string, number> = {};
    for (const ev of [...wafEvents, ...botBlocked]) {
      const tool = detectTool(ev.user_agent || "");
      toolCount[tool] = (toolCount[tool] ?? 0) + 1;
    }
    const userAgentTools = Object.entries(toolCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool, count]) => ({ tool, count }));

    // Method breakdown
    const methodCount: Record<string, number> = {};
    for (const ev of [...wafEvents, ...botBlocked, ...firewallEvents]) {
      const m = ev.method || "?";
      methodCount[m] = (methodCount[m] ?? 0) + 1;
    }
    const byMethod = Object.entries(methodCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([method, count]) => ({ method, count }));

    res.json({
      domains,
      summary: {
        wafBlocked:      totals.waf,
        firewallBlocked: totals.firewall,
        botBlocked:      totals.bot,
        botSimulate:     totals.botSim,
      },
      totals,
      timeline,
      byCountry,
      attackCategories,
      botTypes,
      userAgentTools,
      byMethod,
      topIPs,
      topAlerts,
      topURIs,
      topHosts,
      recentWaf:      wafEvents.slice(0, 50),
      recentFirewall: firewallEvents.slice(0, 30),
      recentBot:      botSimulated.slice(0, 30),
    });
  } catch (err) {
    console.error("[gocache] error:", err);
    res.status(502).json({ error: String(err) });
  }
});

export default router;
