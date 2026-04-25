import { Router } from "express";
import https from "https";

const router = Router();

const DD_SITE = process.env.DD_SITE || "us5.datadoghq.com";
const DD_API_KEY = process.env.DD_API_KEY || "";
const DD_APP_KEY = process.env.DD_APP_KEY || "";

function ddFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options: https.RequestOptions = {
      hostname: `api.${DD_SITE}`,
      path,
      method,
      rejectUnauthorized: false,
      headers: {
        "DD-API-KEY": DD_API_KEY,
        "DD-APPLICATION-KEY": DD_APP_KEY,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
      timeout: 12000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Datadog request timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}

// GET /api/datadog/overview
router.get("/overview", async (_req, res) => {
  try {
    const [monitorsRaw, logsRaw, hostsRaw] = await Promise.all([
      ddFetch("/api/v1/monitor?with_downtimes=false&page=0&page_size=100"),
      ddFetch(
        "/api/v2/logs/events?filter%5Bquery%5D=%2A&filter%5Bfrom%5D=now-4h&filter%5Bto%5D=now&page%5Blimit%5D=1000",
      ),
      ddFetch("/api/v1/hosts?count=100&start=0"),
    ]);

    // ── Monitors ──────────────────────────────────────────────────────────
    const monitors = Array.isArray(monitorsRaw) ? monitorsRaw as Record<string, unknown>[] : [];
    const stateCounts: Record<string, number> = {};
    const alerting: { id: number; name: string; state: string; type: string; query: string }[] = [];
    const noLicense = monitors.filter((m) => !String(m.name).startsWith("[license]"));

    for (const m of monitors) {
      const state = String(m.overall_state ?? "Unknown");
      stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    }
    for (const m of noLicense) {
      const state = String(m.overall_state ?? "Unknown");
      if (state === "Alert" || state === "Warn") {
        alerting.push({
          id: m.id as number,
          name: String(m.name),
          state,
          type: String(m.type),
          query: String((m.query as string || "").slice(0, 120)),
        });
      }
    }

    // License alerts separately
    const licenseAlerts = monitors
      .filter((m) => String(m.name).startsWith("[license]") && String(m.overall_state) === "Alert")
      .map((m) => ({ name: String(m.name), state: String(m.overall_state) }));

    // ── Logs by service ───────────────────────────────────────────────────
    const logsData = ((logsRaw as Record<string, unknown>)?.data ?? []) as Record<string, unknown>[];
    const bySvc: Record<string, { total: number; error: number; warn: number; info: number }> = {};
    const byStatus: Record<string, number> = {};

    for (const ev of logsData) {
      const attrs = (ev.attributes ?? {}) as Record<string, unknown>;
      const svc = String(attrs.service ?? "unknown");
      const status = String(attrs.status ?? "info");
      if (!bySvc[svc]) bySvc[svc] = { total: 0, error: 0, warn: 0, info: 0 };
      bySvc[svc].total++;
      if (status === "error" || status === "critical") bySvc[svc].error++;
      else if (status === "warn" || status === "warning") bySvc[svc].warn++;
      else bySvc[svc].info++;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }

    const logsByService = Object.entries(bySvc)
      .map(([service, counts]) => ({ service, ...counts }))
      .sort((a, b) => b.total - a.total);

    // ── Hosts ─────────────────────────────────────────────────────────────
    const hostsObj = hostsRaw as Record<string, unknown>;
    const hostList = (hostsObj?.host_list ?? []) as Record<string, unknown>[];
    const totalHosts = Number(hostsObj?.total_matching ?? 0);

    const hosts = hostList.map((h) => ({
      name: String(h.host_name ?? ""),
      apps: (h.apps ?? []) as string[],
      lastReported: Number(h.last_reported_time ?? 0),
    }));

    res.json({
      monitors: {
        total: monitors.length,
        stateCounts,
        alerting,
        licenseAlerts,
      },
      logs: {
        total: logsData.length,
        byStatus,
        byService: logsByService,
      },
      hosts: {
        total: totalHosts,
        list: hosts,
      },
    });
  } catch (err) {
    console.error("[datadog] overview error:", err);
    res.status(502).json({ error: String(err) });
  }
});

export default router;
