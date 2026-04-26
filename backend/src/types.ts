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

export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

export function extractUserId(message: string): string | null {
  return message.match(/UserId:\s*(\d+)/)?.[1] ?? null;
}

export function extractGuidCotacao(message: string): string | null {
  const m = message.match(/GUID_COTACAO:\s*([0-9a-fA-F-]{36})/);
  return m ? m[1].toLowerCase() : null;
}

export function extractGuidFromQueryString(qs: string): string | null {
  const m = qs?.match(/[Gg]uid[Qq]uote=([0-9a-fA-F-]{36})/);
  return m ? m[1].toLowerCase() : null;
}

function getProp(properties: { Name: string; Value: unknown }[], name: string): string | null {
  const p = properties.find((p) => p.Name === name);
  return p?.Value != null ? String(p.Value) : null;
}

export function parseSeqApiEvent(e: SeqApiEvent) {
  const props = e.Properties || [];
  const message = e.RenderedMessage || "";
  const queryString = getProp(props, "QueryString") || "";
  return {
    event_id: e.Id || null,
    timestamp: e.Timestamp,
    message,
    level: e.Level || "Information",
    trace_id: getProp(props, "TraceId") || getProp(props, "@tr") || getProp(props, "@@tr"),
    user_id: extractUserId(message) || getProp(props, "UserId"),
    guid_cotacao: extractGuidCotacao(message) || getProp(props, "GUID_COTACAO") || extractGuidFromQueryString(queryString),
    service: getProp(props, "dd_service") || getProp(props, "Application"),
    environment: getProp(props, "dd_env") || getProp(props, "Environment"),
    request_path: getProp(props, "RequestPath"),
    source_context: getProp(props, "SourceContext"),
    raw_data: e,
  };
}
