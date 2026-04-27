import axios from "axios";

const api = axios.create({ baseURL: "/api" });

export interface DbEvent {
  id: string;
  event_id: string | null;
  timestamp: string;
  message: string | null;
  level: string;
  trace_id: string | null;
  user_id: string | null;
  guid_cotacao: string | null;
  service: string | null;
  environment: string | null;
  request_path: string | null;
  source_context: string | null;
  raw_data: Record<string, unknown>;
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
  emptyGuidOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface StatsSummary {
  total: number;
  errors: number;
  byLevel: { level: string; count: string }[];
  topErrors: { message: string; count: string }[];
  topUsers: { user_id: string; count: string }[];
  guidBreakdown: {
    empty_guid: string;
    valid_guid: string;
    no_guid: string;
    total_with_cotacao: string;
  };
  topServices: { service: string; count: string }[];
}

export interface TimelineEntry {
  hour: string;
  level: string;
  count: string;
}

export interface SecurityStats {
  authByEndpoint: { request_path: string; client_id: string; failures: string; unique_users: string }[];
  bruteForce: { username: string; attempts: string; window_minutes: string; rate_per_min: string; first_seen: string; last_seen: string }[];
  anomalousUsernames: { username: string; attempts: string }[];
  topErrorEndpoints: { request_path: string; level: string; count: string }[];
  criticalByContext: { source_context: string; count: string; last_seen: string }[];
  onlyEmptyGuidUsers: { user_id: string; empty_guid_calls: string }[];
  swaggerEvidence: number;
  stackTraceEndpoints: { request_path: string; count: string }[];
  jwtInLogs: { total: number; uniqueTokens: number; firstSeen: string | null; lastSeen: string | null };
  expiredCerts: { count: string; cert_name: string; expired_on: string; first_seen: string; last_seen: string }[];
  dataProtectionUnencrypted: number;
  forwardedHeadersMismatch: number;
  efClientEval: { localEval: number; noOrderBy: number };
  hangfireFailures: { message: string; count: string; last_seen: string }[];
  vehicleIpsExposed: number;
  slowQueries: { count: number; maxMs: number };
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
  empty_guid: number;
}

export interface AuditOverview {
  totals: { service: string; events: number }[];
  topPages: { service: string; page: string; count: number }[];
  topUsers: {
    service: string;
    userId: string;
    count: number;
    maskedAccess: number;
  }[];
  maskedDataAccess: { userId: string; service: string; count: number }[];
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
    masked: boolean;
  }[];
}

export const eventsApi = {
  list: (filters: EventFilters = {}) =>
    api.get<EventsResponse>("/events", { params: filters }).then((r) => r.data),

  get: (id: string) => api.get<DbEvent>(`/events/${id}`).then((r) => r.data),

  stats: () => api.get<StatsSummary>("/events/stats/summary").then((r) => r.data),

  timeline: (hours?: number) =>
    api.get<TimelineEntry[]>("/events/stats/timeline", { params: { hours } }).then((r) => r.data),

  emptyGuidTimeline: () =>
    api.get<{ hour: string; count: string; unique_users: string }[]>(
      "/events/stats/empty-guid-timeline"
    ).then((r) => r.data),

  authErrorStats: () => api.get<AuthErrorStats>("/events/stats/auth-errors").then((r) => r.data),

  securityStats: () => api.get<SecurityStats>("/events/stats/security").then((r) => r.data),

  kongAuthStats: () => api.get<KongAuthStats>("/events/stats/kong-auth").then((r) => r.data),

  datadogOverview: () => api.get<DatadogOverview>("/datadog/overview").then((r) => r.data),

  gocacheOverview: () => api.get<GoCacheOverview>("/gocache/overview").then((r) => r.data),

  datadogMetrics: () => api.get<DatadogMetrics>("/datadog/metrics").then((r) => r.data),

  datadogInfra: () => api.get<DatadogInfra>("/datadog/infra").then((r) => r.data),

  grafanaKubernetes: () => api.get<GrafanaKubernetes>("/grafana/kubernetes").then(r => r.data),
  grafanaJobScheduler: () => api.get<GrafanaJobScheduler>("/grafana/jobscheduler").then(r => r.data),

  auditOverview: () => api.get<AuditOverview>("/audit/overview").then(r => r.data),
};

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

export interface GrafanaProvider {
  name: string;
  processed: number;
  errors: number;
  errorsLastHour: number;
  errorRate: number;
  avgDurationMs: number;
  activeRequests: number;
}

export interface GrafanaJobScheduler {
  providers: GrafanaProvider[];
  totals: {
    processed: number;
    errors: number;
    errorRate: number;
  };
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

export const reportApi = {
  threatReport: () => api.get<ThreatReport>("/report/threat").then((r) => r.data),
};

export const pessoaApi = {
  lookup: (userIds: string[]): Promise<Record<string, string>> =>
    api.get<Record<string, string>>("/pessoa/lookup", {
      params: { userIds: userIds.join(",") },
    }).then((r) => r.data),
};

export const queryKeys = {
  threatReport:    ["threatReport"],
  auditOverview:   ["auditOverview"],
  grafanaK8s:      ["grafanaKubernetes"],
  grafanaJobs:     ["grafanaJobScheduler"],
  datadogOverview: ["datadogOverview"],
  datadogMetrics:  ["datadogMetrics"],
  datadogInfra:    ["datadogInfra"],
  gocacheOverview: ["gocacheOverview"],
  statsSummary:    ["statsSummary"],
  statsTimeline:   ["statsTimeline"],
  kongAuth:        ["kongAuthStats"],
  authErrors:      ["authErrorStats"],
  security:        ["securityStats"],
} as const;
