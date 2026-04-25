import axios from "axios";

const api = axios.create({ baseURL: "/api" });

export interface DbEvent {
  id: number;
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
  service?: string;
  userId?: string;
  guidCotacao?: string;
  requestPath?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
  emptyGuidOnly?: boolean;
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

export interface SyncRequest {
  seqUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
  signal?: string;
  count?: number;
  startDate?: string;
  endDate?: string;
}

export const eventsApi = {
  list: (filters: EventFilters = {}) =>
    api.get<EventsResponse>("/events", { params: filters }).then((r) => r.data),

  get: (id: number) => api.get<DbEvent>(`/events/${id}`).then((r) => r.data),

  stats: () => api.get<StatsSummary>("/events/stats/summary").then((r) => r.data),

  timeline: (hours?: number) =>
    api
      .get<TimelineEntry[]>("/events/stats/timeline", { params: { hours } })
      .then((r) => r.data),

  emptyGuidTimeline: () =>
    api
      .get<{ hour: string; count: string; unique_users: string }[]>(
        "/events/stats/empty-guid-timeline"
      )
      .then((r) => r.data),

  import: (events: unknown[]) =>
    api.post<{ imported: number; skipped: number; total: number }>(
      "/events/import",
      events
    ).then((r) => r.data),

  generateSample: () =>
    api.post<{ imported: number; message: string }>("/events/sample").then((r) => r.data),

  clear: () => api.delete("/events").then((r) => r.data),

  authErrorStats: () =>
    api.get<AuthErrorStats>("/events/stats/auth-errors").then((r) => r.data),

  securityStats: () =>
    api.get<SecurityStats>("/events/stats/security").then((r) => r.data),

  kongAuthStats: () =>
    api.get<KongAuthStats>("/events/stats/kong-auth").then((r) => r.data),

  datadogOverview: () =>
    api.get<DatadogOverview>("/datadog/overview").then((r) => r.data),
};

export const syncApi = {
  login: (seqUrl: string, username: string, password: string) =>
    api
      .post<{ token: string }>("/sync/login", { seqUrl, username, password })
      .then((r) => r.data),

  sync: (body: SyncRequest) =>
    api
      .post<{ imported: number; skipped: number; total: number; pages: number }>("/sync", body)
      .then((r) => r.data),

  getConfig: () =>
    api
      .get<{
        seq_url: string;
        signal: string;
        last_synced_at: string;
        last_count: number;
      } | null>("/sync/config")
      .then((r) => r.data),
};

export interface PessoaStats {
  user_id: string;
  nm_pessoa: string | null;
  total: number;
  errors: number;
  empty_guid: number;
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
  serverErrors: { timestamp: string; username: string; client_ip: string; path: string }[];
  recentFailures: { id: number; timestamp: string; username: string; client_ip: string; path: string; status_code: number; module: string }[];
}

export interface AuthErrorStats {
  total: number;
  timeline: { hour: string; count: string; unique_users: string }[];
  topUsers: { email: string; count: string; last_seen: string }[];
  topClients: { client_id: string; count: string }[];
  recentEvents: {
    id: number;
    event_id: string;
    timestamp: string;
    message: string;
    level: string;
    trace_id: string | null;
    request_path: string | null;
  }[];
}

export interface AutoSyncStatus {
  running: boolean;
  intervalMs: number;
  seqUrl: string;
  signal: string;
  lastRun: string | null;
  lastImported: number;
  lastTotal: number;
  totalImported: number;
  runs: number;
  error: string | null;
}

export const autoSyncApi = {
  start: (opts?: { seqUrl?: string; signal?: string; apiKey?: string; intervalMs?: number }) =>
    api.post<{ message: string; status: AutoSyncStatus }>("/autosync/start", opts || {}).then((r) => r.data),

  stop: () =>
    api.post<{ message: string; status: AutoSyncStatus }>("/autosync/stop").then((r) => r.data),

  status: () =>
    api.get<AutoSyncStatus>("/autosync/status").then((r) => r.data),
};

export interface DatadogOverview {
  monitors: {
    total: number;
    stateCounts: Record<string, number>;
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
}

export const pessoaApi = {
  lookup: (userIds: string[]): Promise<Record<string, string>> =>
    api
      .get<Record<string, string>>("/pessoa/lookup", {
        params: { userIds: userIds.join(",") },
      })
      .then((r) => r.data),

  stats: () =>
    api.get<PessoaStats[]>("/pessoa/stats").then((r) => r.data),
};
