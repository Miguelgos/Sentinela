"use server";
import { createServerFn } from "@tanstack/react-start";
import { ddFetch } from "../../../backend/src/lib/ddClient";

function extract(raw: unknown) {
  const series = ((raw as Record<string, unknown>)?.series ?? []) as Record<string, unknown>[];
  return series.map((s) => {
    const pts = (s.pointlist ?? []) as [number, number | null][];
    const last = [...pts].reverse().find((p) => p[1] !== null);
    return { scope: String(s.scope ?? ""), value: last ? Math.round(last[1]! * 100) / 100 : 0 };
  }).sort((a, b) => b.value - a.value);
}

// ── getDatadogOverview ────────────────────────────────────────────────────────

export const getDatadogOverview = createServerFn({ method: "GET" }).handler(async () => {
  const [monitorsRaw, logsRaw, hostsRaw, slosRaw, downtimesRaw, incidentsRaw] = await Promise.all([
    ddFetch("/api/v1/monitor?with_downtimes=false&page=0&page_size=100"),
    ddFetch(
      "/api/v2/logs/events?filter%5Bquery%5D=%2A&filter%5Bfrom%5D=now-4h&filter%5Bto%5D=now&page%5Blimit%5D=1000",
    ),
    ddFetch("/api/v1/hosts?count=100&start=0"),
    ddFetch("/api/v1/slo?limit=50"),
    ddFetch("/api/v1/downtime?current_only=true"),
    ddFetch("/api/v2/incidents?page[size]=20"),
  ]);

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

  const byType: Record<string, number> = {};
  for (const m of noLicense) {
    const t = String(m.type ?? "unknown");
    byType[t] = (byType[t] ?? 0) + 1;
  }

  const licenseAlerts = monitors
    .filter((m) => String(m.name).startsWith("[license]") && String(m.overall_state) === "Alert")
    .map((m) => ({ name: String(m.name), state: String(m.overall_state) }));

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

  const hostsObj = hostsRaw as Record<string, unknown>;
  const hostList = (hostsObj?.host_list ?? []) as Record<string, unknown>[];
  const totalHosts = Number(hostsObj?.total_matching ?? 0);

  const hosts = hostList.map((h) => ({
    name: String(h.host_name ?? ""),
    apps: (h.apps ?? []) as string[],
    lastReported: Number(h.last_reported_time ?? 0),
  }));

  const sloList = ((slosRaw as Record<string, unknown>)?.data ?? []) as Record<string, unknown>[];
  const downtimeList = Array.isArray(downtimesRaw) ? downtimesRaw as Record<string, unknown>[] : [];
  const incidentList = ((incidentsRaw as Record<string, unknown>)?.data ?? []) as Record<string, unknown>[];

  return {
    monitors: {
      total: monitors.length,
      stateCounts,
      byType,
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
    slos: sloList.map(s => ({
      id: String(s.id),
      name: String(s.name),
      type: String(s.type),
      thresholds: (s.thresholds as { timeframe: string; target: number; target_display: string }[] || []),
    })),
    downtimes: (downtimeList as Record<string, unknown>[]).map(d => ({
      id: Number(d.id),
      monitor_id: d.monitor_id != null ? Number(d.monitor_id) : null,
      message: String(d.message || ""),
      active: Boolean(d.active),
      start: Number(d.start),
      end: d.end != null ? Number(d.end) : null,
      scope: String(d.scope || ""),
    })),
    incidents: (incidentList as Record<string, unknown>[]).map((i) => {
      const attrs = (i.attributes as Record<string, unknown>) || {};
      return {
        public_id: Number(attrs.public_id),
        title: String(attrs.title || ""),
        resolved: attrs.resolved != null ? String(attrs.resolved) : null,
        customer_impact_scope: String(attrs.customer_impact_scope || ""),
        created: String(attrs.created || ""),
      };
    }).filter(i => i.resolved === null),
  };
});

// ── getDatadogMetrics ─────────────────────────────────────────────────────────

export const getDatadogMetrics = createServerFn({ method: "GET" }).handler(async () => {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 3600;

  const q = (query: string) =>
    ddFetch(`/api/v1/query?from=${from}&to=${now}&query=${encodeURIComponent(query)}`);

  const [connRaw, getReqRaw, postReqRaw, bytesRaw, errorsRaw,
         blockedRaw, fullScansRaw, pleRaw, userConnRaw, batchReqRaw] =
    await Promise.all([
      q("sum:iis.net.num_connections{*}by{host}"),
      q("sum:iis.httpd_request_method.get{*}by{site}"),
      q("sum:iis.httpd_request_method.post{*}by{site}"),
      q("sum:iis.net.bytes_total{*}by{host}"),
      q("sum:iis.errors.not_found{*}by{host}"),
      q("avg:sqlserver.activity.blocked_connections{*}by{host}"),
      q("avg:sqlserver.access.full_scans{*}by{host}"),
      q("avg:sqlserver.performance.page_life_expectancy{*}by{host}"),
      q("avg:sqlserver.activity.user_connections{*}by{host}"),
      q("avg:sqlserver.performance.batch_requests_sec{*}by{host}"),
    ]);

  const iisConnections = extract(connRaw).map((s) => ({
    host: s.scope.replace("host:", ""),
    connections: s.value,
  }));

  const getMap: Record<string, number> = {};
  const postMap: Record<string, number> = {};
  for (const s of extract(getReqRaw))  getMap[s.scope.replace("site:", "")]  = s.value;
  for (const s of extract(postReqRaw)) postMap[s.scope.replace("site:", "")] = s.value;
  const allSites = new Set([...Object.keys(getMap), ...Object.keys(postMap)]);
  const iisBySite = [...allSites]
    .map((site) => ({ site, get: getMap[site] ?? 0, post: postMap[site] ?? 0, total: (getMap[site] ?? 0) + (postMap[site] ?? 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  const iisBytes  = extract(bytesRaw).map((s) => ({ host: s.scope.replace("host:", ""), bytes: s.value }));
  const iisErrors = extract(errorsRaw).map((s) => ({ host: s.scope.replace("host:", ""), notFound: s.value }));

  const sqlBlocked   = extract(blockedRaw).map((s)   => ({ host: s.scope.replace("host:", ""), blocked: s.value }));
  const sqlFullScans = extract(fullScansRaw).map((s) => ({ host: s.scope.replace("host:", ""), fullScans: s.value }));
  const sqlPle       = extract(pleRaw).map((s)       => ({ host: s.scope.replace("host:", ""), ple: s.value }));
  const sqlUserConns = extract(userConnRaw).map((s)  => ({ host: s.scope.replace("host:", ""), connections: s.value }));
  const sqlBatchReqs = extract(batchReqRaw).map((s)  => ({ host: s.scope.replace("host:", ""), batchPerSec: s.value }));

  return {
    iis: { connections: iisConnections, bySite: iisBySite, bytes: iisBytes, errors: iisErrors },
    sql: { blocked: sqlBlocked, fullScans: sqlFullScans, ple: sqlPle, userConnections: sqlUserConns, batchRequests: sqlBatchReqs },
  };
});

// ── getDatadogInfra ───────────────────────────────────────────────────────────

export const getDatadogInfra = createServerFn({ method: "GET" }).handler(async () => {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 3600;

  const q = (query: string) =>
    ddFetch(`/api/v1/query?from=${from}&to=${now}&query=${encodeURIComponent(query)}`);

  const [cpuRaw, memRaw, diskRaw, netRaw, podRaw, ctnRaw] = await Promise.all([
    q("avg:system.cpu.user{*}by{host}"),
    q("avg:system.mem.used{*}by{host}"),
    q("avg:system.disk.in_use{*}by{host}"),
    q("sum:system.net.bytes_rcvd{*}by{host}"),
    q("sum:kubernetes.containers.restarts{*}by{kube_deployment}"),
    q("avg:container.cpu.usage{*}by{container_name}"),
  ]);

  const cpuSeries  = extract(cpuRaw);
  const memSeries  = extract(memRaw);
  const diskSeries = extract(diskRaw);
  const netSeries  = extract(netRaw);
  const podSeries  = extract(podRaw);
  const ctnSeries  = extract(ctnRaw);

  return {
    cpu:           cpuSeries.map(s  => ({ host: s.scope.replace("host:", ""),             cpu:       Math.round(s.value * 10)/10 })),
    memory:        memSeries.map(s  => ({ host: s.scope.replace("host:", ""),             memUsedGb: Math.round(s.value / 1073741824 * 10)/10 })),
    disk:          diskSeries.map(s => ({ host: s.scope.replace("host:", ""),             diskPct:   Math.round(s.value * 10)/10 })),
    network:       netSeries.map(s  => ({ host: s.scope.replace("host:", ""),             mbps:      Math.round(s.value / 125000 * 10)/10 })),
    podRestarts:   podSeries.filter(s => s.value > 0)
                             .map(s  => ({ deployment: s.scope.replace("kube_deployment:", ""), restarts: Math.round(s.value) }))
                             .sort((a, b) => b.restarts - a.restarts),
    containerCpu:  ctnSeries.slice(0, 15).map(s => ({ container: s.scope.replace("container_name:", ""), cpu: Math.round(s.value * 10)/10 })),
  };
});
