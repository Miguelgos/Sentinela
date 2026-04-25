import { Router } from "express";
import https from "https";

const router = Router();
const GC_TOKEN = process.env.GC_TOKEN || "";
const GC_BASE  = "api.gocache.com.br";

function gcFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options: https.RequestOptions = {
      hostname: GC_BASE,
      path,
      method,
      rejectUnauthorized: false,
      headers: {
        "GoCache-Token": GC_TOKEN,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
      timeout: 12000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("GoCache timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}

type GcResp = Record<string, unknown>;
type GcEvent = {
  id: string; host: string; domain: string; ip: string; method: string;
  uri: string; user_agent: string; timestamp: number; action: string;
  type: string; country_code: string; referer: string;
  alerts: { id: string; msg: string; match?: string; location?: string }[];
};

function eventsBody(types: string[], actions: string[], from: number, to: number) {
  return { start_date: from, end_date: to, type: types, action: actions, limit: 100 };
}

// GET /api/gocache/overview
router.get("/overview", async (_req, res) => {
  const now  = Math.floor(Date.now() / 1000);
  const from = now - 86400; // last 24h

  try {
    const [domainsRaw, wafBlock, firewallBlock, botBlock, botSim] = await Promise.all([
      gcFetch("/v1/domain") as Promise<GcResp>,
      gcFetch("/v1/threat-hub/events", "POST", eventsBody(["waf"],            ["block"],            from, now)) as Promise<GcResp>,
      gcFetch("/v1/threat-hub/events", "POST", eventsBody(["firewall"],        ["block"],            from, now)) as Promise<GcResp>,
      gcFetch("/v1/threat-hub/events", "POST", eventsBody(["bot-mitigation"],  ["block"],            from, now)) as Promise<GcResp>,
      gcFetch("/v1/threat-hub/events", "POST", eventsBody(["bot-mitigation"],  ["simulate"],         from, now)) as Promise<GcResp>,
    ]);

    const domains = ((domainsRaw?.response as GcResp)?.domains ?? []) as string[];

    function parseEvents(raw: GcResp): GcEvent[] {
      return (((raw?.response as GcResp)?.events ?? []) as GcEvent[]);
    }
    function totalOf(raw: GcResp): number {
      return Number((raw?.response as GcResp)?.size ?? 0);
    }

    const wafEvents      = parseEvents(wafBlock);
    const firewallEvents = parseEvents(firewallBlock);
    const botBlocked     = parseEvents(botBlock);
    const botSimulated   = parseEvents(botSim);

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

    res.json({
      domains,
      summary: {
        wafBlocked:    totalOf(wafBlock),
        firewallBlocked: totalOf(firewallBlock),
        botBlocked:    totalOf(botBlock),
        botSimulate:   totalOf(botSim),
      },
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
