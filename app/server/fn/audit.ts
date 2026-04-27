"use server";
import { createServerFn } from "@tanstack/react-start";
import { lokiQueryRange } from "../../../backend/src/lib/lokiClient";
import type { LokiStream } from "../../../backend/src/lib/lokiClient";

interface RawAuditLog {
  CD_USUARIO?:     number | string;
  IP_USUARIO?:     string;
  PAGINA_ACESSADA?: string;
  CD_SISTEMA?:     number | string;
  JS_PARAMETROS?:  string | Record<string, unknown>;
  Message?:        string;
  [key: string]:   unknown;
}

interface AuditEvent {
  service:   string;
  timestampMs: number;
  userId:    string;
  ip:        string;
  page:      string;
  sistema:   number;
  unmasked:  boolean;
}

function isExternalIp(ip: string): boolean {
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/, "");
  if (normalized.startsWith("10."))       return false;
  if (normalized.startsWith("172.16."))   return false;
  if (normalized.startsWith("172.17."))   return false;
  if (normalized.startsWith("192.168."))  return false;
  if (normalized === "127.0.0.1")         return false;
  if (normalized === "::1")               return false;
  return true;
}

// JS_PARAMETROS contém ViewMaskedData=true quando o usuário visualizou
// os dados SEM máscara (acessou o dado real, sensível para LGPD).
function viewedUnmaskedData(jsParametros: string | Record<string, unknown> | undefined): boolean {
  if (!jsParametros) return false;
  try {
    const obj: Record<string, unknown> =
      typeof jsParametros === "string" ? JSON.parse(jsParametros) : jsParametros;
    return obj["ViewMaskedData"] === true || obj["ViewMaskedData"] === "true";
  } catch {
    if (typeof jsParametros === "string") {
      return jsParametros.includes("ViewMaskedData") && jsParametros.includes("true");
    }
    return false;
  }
}

function parseRawLog(line: string): RawAuditLog | null {
  try {
    return JSON.parse(line) as RawAuditLog;
  } catch {
    return null;
  }
}

function extractEvent(service: string, tsNs: string, line: string): AuditEvent | null {
  try {
    const outer = parseRawLog(line);
    if (!outer) return null;

    let fields: RawAuditLog;
    if (service === "customer360" && typeof outer.Message === "string") {
      try {
        fields = JSON.parse(outer.Message) as RawAuditLog;
      } catch {
        fields = outer;
      }
    } else {
      fields = outer;
    }

    const userId = String(fields.CD_USUARIO ?? "unknown");
    const ip     = String(fields.IP_USUARIO   ?? "");
    const page   = String(fields.PAGINA_ACESSADA ?? "");
    const sistema = Number(fields.CD_SISTEMA ?? 0);
    const unmasked = viewedUnmaskedData(fields.JS_PARAMETROS);
    const timestampMs = Math.floor(Number(tsNs) / 1_000_000);

    return { service, timestampMs, userId, ip, page, sistema, unmasked };
  } catch {
    return null;
  }
}

function streamsToEvents(service: string, streams: LokiStream[]): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (const stream of streams) {
    for (const [tsNs, line] of stream.values) {
      const ev = extractEvent(service, tsNs, line);
      if (ev) events.push(ev);
    }
  }
  return events;
}

export const getAuditOverview = createServerFn({ method: "GET" }).handler(async () => {
  const toNs   = Date.now() * 1_000_000;
  const fromNs = (Date.now() - 86_400_000) * 1_000_000;

  const services: { name: string; query: string }[] = [
    { name: "Integra",      query: '{app="Integra",log_type="audit"}' },
    { name: "customer360",  query: '{app="customer360",log_type="audit"}' },
    { name: "fieldservice", query: '{app="fieldservice",log_type="audit"}' },
  ];

  const results = await Promise.allSettled(
    services.map((svc) => lokiQueryRange(svc.query, fromNs, toNs, 2000)),
  );

  const allEvents: AuditEvent[] = [];
  for (let i = 0; i < services.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      const events = streamsToEvents(services[i].name, result.value);
      allEvents.push(...events);
    }
  }

  // totals
  const totalMap = new Map<string, number>();
  for (const ev of allEvents) {
    totalMap.set(ev.service, (totalMap.get(ev.service) ?? 0) + 1);
  }
  const totals = services.map((svc) => ({
    service: svc.name,
    events:  totalMap.get(svc.name) ?? 0,
  }));

  // topPages per service
  const pageMap = new Map<string, number>();
  for (const ev of allEvents) {
    if (!ev.page) continue;
    const key = `${ev.service}||${ev.page}`;
    pageMap.set(key, (pageMap.get(key) ?? 0) + 1);
  }
  const topPages: { service: string; page: string; count: number }[] = [];
  const pagesByService = new Map<string, { page: string; count: number }[]>();
  for (const [key, count] of pageMap.entries()) {
    const [service, page] = key.split("||");
    if (!pagesByService.has(service)) pagesByService.set(service, []);
    pagesByService.get(service)!.push({ page, count });
  }
  for (const [service, pages] of pagesByService.entries()) {
    pages.sort((a, b) => b.count - a.count);
    for (const p of pages.slice(0, 15)) {
      topPages.push({ service, page: p.page, count: p.count });
    }
  }

  // topUsers
  const userKey = (svc: string, uid: string) => `${svc}||${uid}`;
  const userCount    = new Map<string, number>();
  const userUnmasked = new Map<string, number>();
  for (const ev of allEvents) {
    const k = userKey(ev.service, ev.userId);
    userCount.set(k, (userCount.get(k) ?? 0) + 1);
    if (ev.unmasked) userUnmasked.set(k, (userUnmasked.get(k) ?? 0) + 1);
  }
  const topUsers = Array.from(userCount.entries())
    .map(([k, count]) => {
      const [service, userId] = k.split("||");
      return { service, userId, count, unmaskedAccess: userUnmasked.get(k) ?? 0 };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // unmaskedDataAccess — usuários que viram dados sem máscara (relevante LGPD)
  const unmaskedMap = new Map<string, { count: number; service: string }>();
  for (const ev of allEvents) {
    if (!ev.unmasked) continue;
    const existing = unmaskedMap.get(ev.userId);
    if (!existing) {
      unmaskedMap.set(ev.userId, { count: 1, service: ev.service });
    } else {
      existing.count += 1;
    }
  }
  const unmaskedDataAccess = Array.from(unmaskedMap.entries())
    .map(([userId, v]) => ({ userId, service: v.service, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // externalIPs
  const externalIPs = allEvents
    .filter((ev) => isExternalIp(ev.ip))
    .map((ev) => ({
      ip:        ev.ip,
      userId:    ev.userId,
      page:      ev.page,
      timestamp: new Date(ev.timestampMs).toISOString(),
    }));

  // suspiciousUsers
  const suspiciousUsers = Array.from(userCount.entries())
    .filter(([k, count]) => count > 100 && !k.endsWith("||unknown") && !k.endsWith("||"))
    .map(([k, count]) => {
      const [service, userId] = k.split("||");
      const uniquePages = new Set(
        allEvents.filter((ev) => ev.service === service && ev.userId === userId).map((ev) => ev.page),
      ).size;
      return { userId, service, count, uniquePages };
    })
    .sort((a, b) => b.count - a.count);

  // recentEvents
  const recentEvents = allEvents
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, 30)
    .map((ev) => ({
      timestamp: new Date(ev.timestampMs).toISOString(),
      service:   ev.service,
      userId:    ev.userId,
      ip:        ev.ip,
      page:      ev.page,
      unmasked:  ev.unmasked,
    }));

  return {
    totals,
    topPages,
    topUsers,
    unmaskedDataAccess,
    externalIPs,
    suspiciousUsers,
    recentEvents,
  };
});
