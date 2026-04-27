// ── Server function imports ───────────────────────────────────────────────────
import {
  listEvents,
  getEvent,
  getStatsSummary,
  getTimeline,
  getAuthErrorStats,
  getKongAuthStats,
} from "../../../app/server/fn/events";
import { lookupPessoa } from "../../../app/server/fn/pessoa";
import {
  getDatadogOverview,
  getDatadogMetrics,
  getDatadogInfra,
} from "../../../app/server/fn/datadog";
import { getGocacheOverview } from "../../../app/server/fn/gocache";
import { getThreatReport } from "../../../app/server/fn/report";
import { getGrafanaKubernetes } from "../../../app/server/fn/grafana";
import { getAuditOverview } from "../../../app/server/fn/audit";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DbEvent {
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
}

export interface EventsResponse {
  data: DbEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface EventFilters {
  level?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface StatsSummary {
  total: number;
  errors: number;
  byLevel: { level: string; count: string }[];
  topErrors: { message: string; count: string }[];
  topUsers: { user_id: string; count: string }[];
  topServices: { service: string; count: string }[];
}

export interface TimelineEntry {
  hour: string;
  level: string;
  count: string;
}

export interface KongAuthStats {
  summary: {
    total: number;
    failures: number;
    successes: number;
    failures401: number;
    failures500: number;
    failurePct: number;
  };
  timeline: { hora: string; falhas: number; sucessos: number }[];
  topUsers: { username: string; falhas: string; first_seen: string; last_seen: string }[];
  topIPs: { client_ip: string; falhas: string; usuarios_unicos: string; first_seen: string; last_seen: string }[];
  credentialStuffing: { client_ip: string; usuarios_tentados: string; total_falhas: string; janela_min: string; first_seen: string; last_seen: string }[];
  anomalousUsernames: { username: string; client_ip: string; tentativas: string }[];
  serverErrors: { timestamp: string; username: string | null; client_ip: string | null; path: string | null }[];
  recentFailures: { id: number; timestamp: string; username: string | null; client_ip: string | null; path: string | null; status_code: number; module: string | null }[];
}

export interface AuthErrorStats {
  total: number;
  timeline: { hour: string; count: string; unique_users: string }[];
  topUsers: { email: string; count: string; last_seen: string }[];
  topClients: { client_id: string; count: string }[];
  recentEvents: {
    id: string | number;
    event_id: string;
    timestamp: string;
    message: string | null;
    level: string;
    trace_id: string | null;
    request_path: string | null;
  }[];
}

export interface GoCacheEvent {
  id: string; host: string; domain: string; ip: string; method: string;
  uri: string; user_agent: string; timestamp: number; action: string;
  type: string; country_code: string; referer: string;
  alerts: { id: string; msg: string; match?: string }[];
}

export interface GoCacheOverview {
  domains: string[];
  summary: { wafBlocked: number; firewallBlocked: number; botBlocked: number; botSimulate: number };
  topIPs:     { ip: string; count: number }[];
  topAlerts:  { id: string; count: number }[];
  topURIs:    { uri: string; count: number }[];
  topHosts:   { host: string; count: number }[];
  recentWaf:      GoCacheEvent[];
  recentFirewall: GoCacheEvent[];
  recentBot:      GoCacheEvent[];
  totals?: { waf: number; firewall: number; bot: number; botSim: number };
  timeline?: { hour: string; waf: number; bot: number; firewall: number }[];
  byCountry?: { country: string; count: number }[];
  attackCategories?: { category: string; count: number }[];
  botTypes?: { type: string; count: number }[];
  userAgentTools?: { tool: string; count: number }[];
  byMethod?: { method: string; count: number }[];
}

export interface DatadogMetrics {
  iis: {
    connections: { host: string; connections: number }[];
    bySite:      { site: string; get: number; post: number; total: number }[];
    bytes:       { host: string; bytes: number }[];
    errors:      { host: string; notFound: number }[];
  };
  sql: {
    blocked:        { host: string; blocked: number }[];
    fullScans:      { host: string; fullScans: number }[];
    ple:            { host: string; ple: number }[];
    userConnections:{ host: string; connections: number }[];
    batchRequests:  { host: string; batchPerSec: number }[];
  };
}

export interface DatadogInfra {
  cpu:          { host: string; cpu: number }[];
  memory:       { host: string; memUsedGb: number }[];
  disk:         { host: string; diskPct: number }[];
  network:      { host: string; mbps: number }[];
  podRestarts:  { deployment: string; restarts: number }[];
  containerCpu: { container: string; cpu: number }[];
}

export interface DatadogOverview {
  monitors: {
    total: number;
    stateCounts: Record<string, number>;
    byType: Record<string, number>;
    alerting: { id: number; name: string; state: string; type: string; query: string }[];
    licenseAlerts: { name: string; state: string }[];
  };
  logs: {
    total: number;
    byStatus: Record<string, number>;
    byService: { service: string; total: number; error: number; warn: number; info: number }[];
  };
  hosts: {
    total: number;
    list: { name: string; apps: string[]; lastReported: number }[];
  };
  slos?: { id: string; name: string; type: string; thresholds: { timeframe: string; target: number; target_display: string }[] }[];
  downtimes?: { id: number; monitor_id: number | null; message: string; active: boolean; start: number; end: number | null; scope: string }[];
  incidents?: { public_id: number; title: string; resolved: string | null; customer_impact_scope: string; created: string }[];
}

export interface PessoaStats {
  user_id: string;
  nm_pessoa: string | null;
  total: number;
  errors: number;
}

export interface AuditOverview {
  totals: { service: string; events: number }[];
  topPages: { service: string; page: string; count: number }[];
  topUsers: {
    service: string;
    userId: string;
    count: number;
    unmaskedAccess: number;
  }[];
  unmaskedDataAccess: { userId: string; service: string; count: number }[];
  externalIPs: {
    ip: string;
    userId: string;
    page: string;
    timestamp: string;
  }[];
  suspiciousUsers: {
    userId: string;
    service: string;
    count: number;
    uniquePages: number;
  }[];
  recentEvents: {
    timestamp: string;
    service: string;
    userId: string;
    ip: string;
    page: string;
    unmasked: boolean;
  }[];
}

export interface GrafanaPod {
  name: string;
  cpuPct: number;
  memMb: number;
  restarts: number;
}

export interface GrafanaAlert {
  name: string;
  severity: string;
  namespace: string;
  state: string;
  labels: Record<string, string>;
}

export interface GrafanaKubernetes {
  salesbo: {
    replicas: { available: number; desired: number };
    totalCpuPct: number;
    totalMemGb: number;
    pods: GrafanaPod[];
  };
  deploymentsDown: string[];
  podRestarts: { pod: string; restarts: number }[];
  alerts: GrafanaAlert[];
}

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface CorrelatedThreat {
  rule: string;
  title: string;
  description: string;
  risk: RiskLevel;
  evidence: string[];
  indicators: string[];
}

export interface ThreatReport {
  generatedAt: string;
  riskLevel: RiskLevel;
  findings: CorrelatedThreat[];
  narrative: string;
  narrativeError?: string;
  sources: {
    seq:     { ok: boolean; events: number };
    datadog: { ok: boolean; alerts: number };
    gocache: { ok: boolean; blocked: number };
  };
}

// ── API objects ───────────────────────────────────────────────────────────────

export const eventsApi = {
  list:               (filters: EventFilters = {}) => listEvents({ data: filters }),
  get:                (id: string)                  => getEvent({ data: { id } }),
  stats:              ()                            => getStatsSummary(),
  timeline:           (hours?: number)              => getTimeline({ data: { hours } }),
  authErrorStats:     ()                            => getAuthErrorStats(),
  kongAuthStats:      ()                            => getKongAuthStats(),
  datadogOverview:    ()                            => getDatadogOverview(),
  gocacheOverview:    ()                            => getGocacheOverview(),
  datadogMetrics:     ()                            => getDatadogMetrics(),
  datadogInfra:       ()                            => getDatadogInfra(),
  grafanaKubernetes:  ()                            => getGrafanaKubernetes(),
  auditOverview:      ()                            => getAuditOverview(),
};

export const reportApi = {
  threatReport: () => getThreatReport(),
};

export const pessoaApi = {
  lookup: (userIds: string[]): Promise<Record<string, string>> =>
    lookupPessoa({ data: { userIds: userIds.join(",") } }),
};

export const queryKeys = {
  threatReport:    ["threatReport"],
  auditOverview:   ["auditOverview"],
  grafanaK8s:      ["grafanaKubernetes"],
  datadogOverview: ["datadogOverview"],
  datadogMetrics:  ["datadogMetrics"],
  datadogInfra:    ["datadogInfra"],
  gocacheOverview: ["gocacheOverview"],
  statsSummary:    ["statsSummary"],
  statsTimeline:   ["statsTimeline"],
  kongAuth:        ["kongAuthStats"],
  authErrors:      ["authErrorStats"],
} as const;
