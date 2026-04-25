// CLEF format (from /api/events/raw or imported JSON)
export interface RawSeqEvent {
  "@t": string;
  "@mt"?: string;
  "@m"?: string;
  "@i"?: string;
  "@l"?: string;
  "@@tr"?: string;
  "@@sp"?: string;
  SourceContext?: string;
  dd_service?: string;
  dd_env?: string;
  RequestPath?: string;
  [key: string]: unknown;
}

// REST API format (from /api/events/ — no auth required)
export interface SeqApiEvent {
  Id: string;
  Timestamp: string;
  Level: string;
  RenderedMessage: string;
  Exception?: string;
  EventType?: string;
  Properties: { Name: string; Value: unknown }[];
  MessageTemplateTokens?: unknown[];
  Links?: unknown;
}

export interface DbEvent {
  id: number;
  event_id: string | null;
  timestamp: string;
  message_template: string | null;
  message: string | null;
  level: string;
  trace_id: string | null;
  span_id: string | null;
  user_id: string | null;
  guid_cotacao: string | null;
  service: string | null;
  environment: string | null;
  request_path: string | null;
  source_context: string | null;
  raw_data: RawSeqEvent | SeqApiEvent;
  created_at: string;
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

export interface SyncRequest {
  seqUrl: string;
  apiKey?: string;
  signal?: string;
  count?: number;
  startDate?: string;
  endDate?: string;
}

export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

export function extractUserId(message: string): string | null {
  const match = message.match(/UserId:\s*(\d+)/);
  return match ? match[1] : null;
}

export function extractGuidCotacao(message: string): string | null {
  const match = message.match(/GUID_COTACAO:\s*([0-9a-fA-F-]{36})/);
  return match ? match[1].toLowerCase() : null;
}

function getProp(properties: { Name: string; Value: unknown }[], name: string): string | null {
  const p = properties.find((p) => p.Name === name);
  return p && p.Value != null ? String(p.Value) : null;
}

// Parse CLEF format
export function parseSeqEvent(raw: RawSeqEvent) {
  const message = (raw["@m"] || raw["@mt"] || "") as string;
  return {
    event_id: (raw["@i"] as string | undefined) || null,
    timestamp: raw["@t"],
    message_template: (raw["@mt"] as string | undefined) || null,
    message,
    level: (raw["@l"] as string | undefined) || "Information",
    trace_id: (raw["@@tr"] as string | undefined) || null,
    span_id: (raw["@@sp"] as string | undefined) || null,
    user_id: extractUserId(message),
    guid_cotacao: extractGuidCotacao(message),
    service: (raw["dd_service"] as string | undefined) || null,
    environment: (raw["dd_env"] as string | undefined) || null,
    request_path: (raw["RequestPath"] as string | undefined) || null,
    source_context: (raw["SourceContext"] as string | undefined) || null,
    raw_data: raw as unknown as RawSeqEvent,
  };
}

// Parse Seq REST API format (no-auth endpoint)
export function parseSeqApiEvent(e: SeqApiEvent) {
  const props = e.Properties || [];
  const message = e.RenderedMessage || "";

  return {
    event_id: e.Id || null,
    timestamp: e.Timestamp,
    message_template: null as string | null,
    message,
    level: e.Level || "Information",
    trace_id: getProp(props, "TraceId") || getProp(props, "@@tr"),
    span_id: getProp(props, "SpanId") || getProp(props, "@@sp"),
    user_id: extractUserId(message) || getProp(props, "UserId"),
    guid_cotacao: extractGuidCotacao(message) || getProp(props, "GUID_COTACAO"),
    service: getProp(props, "dd_service") || getProp(props, "Application"),
    environment: getProp(props, "dd_env") || getProp(props, "Environment"),
    request_path: getProp(props, "RequestPath"),
    source_context: getProp(props, "SourceContext"),
    raw_data: e as unknown as RawSeqEvent,
  };
}
