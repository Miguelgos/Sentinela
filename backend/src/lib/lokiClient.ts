import { makeClient } from "./httpClient";

const AUDIT_DS_UID = process.env.LOKI_AUDIT_UID || "P73FAD9A5042C01FF";

export interface LokiStream {
  stream: Record<string, string>;
  values: [string, string][]; // [timestamp_ns_string, log_line]
}

function lokiGet(path: string): Promise<unknown> {
  const GRAFANA_URL   = process.env.GRAFANA_URL   || "http://grafana-prd.ituran.sp";
  const GRAFANA_TOKEN = process.env.GRAFANA_TOKEN || "";

  const request = makeClient({
    baseUrl:  GRAFANA_URL,
    headers:  { Authorization: `Bearer ${GRAFANA_TOKEN}` },
    timeoutMs: 20_000,
  });

  return request(path);
}

export async function lokiQueryRange(
  query: string,
  fromNs: number,
  toNs: number,
  limit = 1000,
  direction: "backward" | "forward" = "backward",
): Promise<LokiStream[]> {
  try {
    const qs = [
      `query=${encodeURIComponent(query)}`,
      `start=${fromNs}`,
      `end=${toNs}`,
      `limit=${limit}`,
      `direction=${direction}`,
    ].join("&");

    const path = `/api/datasources/proxy/uid/${AUDIT_DS_UID}/loki/api/v1/query_range?${qs}`;
    const json  = await lokiGet(path) as Record<string, unknown> | null;
    const data  = (json?.data as Record<string, unknown>) ?? {};
    return (data.result as LokiStream[]) ?? [];
  } catch {
    return [];
  }
}
