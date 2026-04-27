import http from "http";

type PromResult = { metric: Record<string, string>; value: [number, string] };
type PromRangeResult = { metric: Record<string, string>; values: [number, string][] };

function grafanaGet(path: string): Promise<unknown> {
  const GRAFANA_URL   = process.env.GRAFANA_URL  || "http://grafana-prd.ituran.sp";
  const GRAFANA_TOKEN = process.env.GRAFANA_TOKEN || "";

  return new Promise((resolve) => {
    const url  = new URL(path, GRAFANA_URL);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname + url.search,
      method:   "GET",
      family:   4,
      headers: {
        Authorization:  `Bearer ${GRAFANA_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try   { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on("error",   () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

export async function grafanaPromQuery(promql: string): Promise<PromResult[]> {
  try {
    const path = `/api/datasources/proxy/uid/prometheus/api/v1/query?query=${encodeURIComponent(promql)}`;
    const json  = await grafanaGet(path) as Record<string, unknown> | null;
    const data  = (json?.data as Record<string, unknown>) ?? {};
    return (data.result as PromResult[]) ?? [];
  } catch {
    return [];
  }
}

export async function grafanaPromRange(
  promql: string,
  startSec: number,
  endSec: number,
  step: number,
): Promise<PromRangeResult[]> {
  try {
    const qs   = `query=${encodeURIComponent(promql)}&start=${startSec}&end=${endSec}&step=${step}`;
    const path = `/api/datasources/proxy/uid/prometheus/api/v1/query_range?${qs}`;
    const json  = await grafanaGet(path) as Record<string, unknown> | null;
    const data  = (json?.data as Record<string, unknown>) ?? {};
    return (data.result as PromRangeResult[]) ?? [];
  } catch {
    return [];
  }
}

export async function grafanaFiringAlerts(): Promise<
  { name: string; severity: string; namespace: string; state: string; labels: Record<string, string> }[]
> {
  try {
    const results = await grafanaPromQuery('ALERTS{alertstate="firing"}');
    return results
      .map((r) => ({
        name:      r.metric.alertname  ?? "",
        severity:  r.metric.severity   ?? "",
        namespace: r.metric.namespace  ?? "",
        state:     r.metric.alertstate ?? "",
        labels:    r.metric,
      }))
      .filter((a) => a.name !== "Watchdog" && a.name !== "InfoInhibitor");
  } catch {
    return [];
  }
}
