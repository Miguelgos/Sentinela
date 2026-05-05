import { getEvents } from "./accumulator";
import { emailFrom } from "./seq";
import { gcFetch } from "./lib/gcClient";
import { ddFetch } from "./lib/ddClient";
import { grafanaPromQuery, grafanaFiringAlerts } from "./lib/grafanaClient";
import { lokiQueryRange, type LokiStream } from "./lib/lokiClient";
import { correlateProblems, detectors as anomalyDetectors, MS_PER_MINUTE, type AnomalyProblem } from "./anomaly";

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface CorrelatedThreat {
  rule: string;
  title: string;
  description: string;
  risk: RiskLevel;
  evidence: string[];
  indicators: string[];
}

const RISK_ORDER: Record<RiskLevel, number> = {
  CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0,
};

export function maxRisk(findings: CorrelatedThreat[]): RiskLevel {
  if (findings.length === 0) return "INFO";
  return findings.reduce(
    (max, f) => (RISK_ORDER[f.risk] > RISK_ORDER[max] ? f.risk : max),
    "INFO" as RiskLevel,
  );
}

function classifyAlert(msg: string, id: string): string {
  const m = (msg ?? "").toLowerCase();
  const i = id ?? "";
  if (m.includes("sql") || m.includes("injection") || /^94[0-9]/.test(i) || /^93[0-9]/.test(i)) return "SQLi";
  if (m.includes("xss") || m.includes("script") || /^941/.test(i)) return "XSS";
  if (m.includes("traversal") || m.includes("path") || /^930/.test(i)) return "PathTraversal";
  if (m.includes("scan") || m.includes("nikto") || m.includes("nmap")) return "Scanner";
  if (m.includes("protocol") || /^92[0-9]/.test(i)) return "Protocol";
  return "Other";
}

function detectTool(ua: string): string {
  if (!ua) return "Unknown";
  const u = ua.toLowerCase();
  if (u.includes("sqlmap"))  return "SQLMap";
  if (u.includes("nikto"))   return "Nikto";
  if (u.includes("dart"))    return "Dart";
  if (u.includes("python"))  return "Python";
  if (u.includes("curl"))    return "curl";
  if (u.includes("go-http")) return "Go";
  if (u.includes("java") && !u.includes("javascript")) return "Java";
  if (u.includes("headlesschrome") || u.includes("phantomjs")) return "Headless";
  return "Browser/Other";
}

type GcRawEvent = { ip: string; uri: string; user_agent?: string; country_code?: string; alerts: { id: string; msg: string; match?: string }[] };
type Monitor = Record<string, unknown>;
type IncidentAttr = Record<string, unknown>;
type Incident = { attributes: IncidentAttr };
type SeriesPoint = { scope: string; value: number };
type SloEntry = { name: string; status: { error_budget_remaining?: number } };

interface AuditSummary {
  service: string;
  total: number;
  unmasked: number;
  externalIPs: string[];
  topUsers: { userId: string; count: number }[];
}

export interface ThreatContext {
  seqEvents: ReturnType<typeof getEvents>;
  authFails: ReturnType<typeof getEvents>;
  monitors: Monitor[];
  alertMonitors: Monitor[];
  activeIncidents: Incident[];
  infra: { cpu: SeriesPoint[]; podRestarts: SeriesPoint[]; disk: SeriesPoint[] };
  wafEvents: GcRawEvent[];
  botEvents: GcRawEvent[];
  firewallEvents: GcRawEvent[];
  gcBlockedTotal: number;
  attackCategoryMap: Record<string, number>;
  toolMap: Record<string, number>;
  topCountries: [string, number][];
  auditSummaries: AuditSummary[];
  auditTotal: number;
  auditUnmasked: number;
  auditExternalIPs: string[];
  firingAlerts: Awaited<ReturnType<typeof grafanaFiringAlerts>>;
  criticalAlerts: Awaited<ReturnType<typeof grafanaFiringAlerts>>;
  downDeps: string[];
  breachedSlos: SloEntry[];
  anomalyProblems: AnomalyProblem[];
  sources: { seqOk: boolean; ddOk: boolean; gcOk: boolean };
}

function gcEvents(result: PromiseSettledResult<unknown>): GcRawEvent[] {
  if (result.status !== "fulfilled") return [];
  const r = result.value as Record<string, unknown>;
  return (((r?.response as Record<string, unknown>)?.events ?? []) as GcRawEvent[]);
}

function extractMetric(raw: unknown): SeriesPoint[] {
  const series = (((raw as Record<string, unknown>)?.series ?? []) as Record<string, unknown>[]);
  return series.map(s => {
    const pts = (s.pointlist ?? []) as [number, number | null][];
    const last = [...pts].reverse().find(p => p[1] !== null);
    return { scope: String(s.scope ?? ""), value: last ? Math.round(last[1]! * 10) / 10 : 0 };
  });
}

function processLokiAudit(service: string, result: PromiseSettledResult<unknown>): AuditSummary {
  const summary: AuditSummary = { service, total: 0, unmasked: 0, externalIPs: [], topUsers: [] };
  if (result.status !== "fulfilled") return summary;
  const streams = result.value as LokiStream[];
  const userCount: Record<string, number> = {};
  for (const stream of streams) {
    for (const [, line] of stream.values) {
      summary.total++;
      try {
        const outer = JSON.parse(line) as Record<string, unknown>;
        const fields = (service === "customer360" && typeof outer.Message === "string")
          ? JSON.parse(outer.Message) as Record<string, unknown>
          : outer;
        const userId = String(fields.CD_USUARIO ?? "");
        if (userId) userCount[userId] = (userCount[userId] ?? 0) + 1;
        const ip = String(fields.IP_USUARIO ?? "").replace(/^::ffff:/, "");
        if (ip && !ip.startsWith("10.") && !ip.startsWith("172.") && !ip.startsWith("192.168.") && ip !== "127.0.0.1" && ip !== "::1" && ip !== "") {
          summary.externalIPs.push(ip);
        }
        const jsParams = fields.JS_PARAMETROS;
        if (jsParams) {
          try {
            const p = typeof jsParams === "string" ? JSON.parse(jsParams) as Record<string, unknown> : jsParams as Record<string, unknown>;
            if (p.ViewMaskedData === true || p.ViewMaskedData === "true") summary.unmasked++;
          } catch {
            if (typeof jsParams === "string" && jsParams.includes("ViewMaskedData") && jsParams.includes("true")) summary.unmasked++;
          }
        }
      } catch { /* skip malformed */ }
    }
  }
  summary.topUsers = Object.entries(userCount)
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count).slice(0, 5);
  summary.externalIPs = [...new Set(summary.externalIPs)].slice(0, 10);
  return summary;
}

export async function fetchThreatContext(): Promise<ThreatContext> {
  const now    = Math.floor(Date.now() / 1000);
  const from24 = now - 86400;
  const toNs   = Date.now() * 1_000_000;
  const fromNs = (Date.now() - 86_400_000) * 1_000_000;

  const [
    seqResult, ddMonitorsResult, ddIncidentsResult,
    gcWafResult, gcBotResult, gcFirewallResult,
    ddInfraResult,
    grafanaAlertsResult, grafanaDownResult,
    lokiIntegraResult, lokiC360Result, lokiFsResult,
    ddSloResult,
  ] = await Promise.allSettled([
    Promise.resolve(getEvents()),
    ddFetch("/api/v1/monitor?with_downtimes=false&page=0&page_size=100"),
    ddFetch("/api/v2/incidents?page[size]=20"),
    gcFetch("/v1/threat-hub/events", "POST", { start_date: from24, end_date: now, type: ["waf"], action: ["block"], limit: 200 }),
    gcFetch("/v1/threat-hub/events", "POST", { start_date: from24, end_date: now, type: ["bot-mitigation"], action: ["block"], limit: 200 }),
    gcFetch("/v1/threat-hub/events", "POST", { start_date: from24, end_date: now, type: ["firewall"], action: ["block"], limit: 200 }),
    Promise.all([
      ddFetch(`/api/v1/query?from=${now - 3600}&to=${now}&query=${encodeURIComponent("avg:system.cpu.user{*}by{host}")}`),
      ddFetch(`/api/v1/query?from=${now - 3600}&to=${now}&query=${encodeURIComponent("sum:kubernetes.containers.restarts{*}by{kube_deployment}")}`),
      ddFetch(`/api/v1/query?from=${now - 3600}&to=${now}&query=${encodeURIComponent("avg:system.disk.in_use{*}by{host}")}`),
    ]),
    grafanaFiringAlerts(),
    grafanaPromQuery('kube_deployment_status_replicas_available{namespace="integra-prd"} == 0'),
    lokiQueryRange('{app="Integra",log_type="audit"}',      fromNs, toNs, 500),
    lokiQueryRange('{app="customer360",log_type="audit"}',  fromNs, toNs, 500),
    lokiQueryRange('{app="fieldservice",log_type="audit"}', fromNs, toNs, 500),
    ddFetch("/api/v1/slo?limit=100"),
  ]);

  const seqOk = seqResult.status === "fulfilled";
  const ddOk  = ddMonitorsResult.status === "fulfilled";
  const gcOk  = gcWafResult.status === "fulfilled";

  const seqEvents = seqOk ? seqResult.value : [];
  const authFails = seqEvents.filter(e => e.message?.includes("Erro autenticação"));

  const monitors = ddOk && Array.isArray(ddMonitorsResult.value)
    ? (ddMonitorsResult.value as Monitor[])
    : [];
  const alertMonitors = monitors.filter(m => {
    const state = String(m.overall_state ?? "");
    return (state === "Alert" || state === "Warn") && !String(m.name ?? "").startsWith("[license]");
  });

  const rawIncidents = ddIncidentsResult.status === "fulfilled"
    ? (((ddIncidentsResult.value as Record<string, unknown>)?.data ?? []) as Incident[])
    : [];
  const activeIncidents = rawIncidents.filter(i => i.attributes?.resolved == null);

  const infra = { cpu: [] as SeriesPoint[], podRestarts: [] as SeriesPoint[], disk: [] as SeriesPoint[] };
  if (ddInfraResult.status === "fulfilled") {
    const [cpuRaw, podRaw, diskRaw] = ddInfraResult.value as unknown[];
    infra.cpu = extractMetric(cpuRaw);
    infra.podRestarts = extractMetric(podRaw).filter(s => s.value > 0);
    infra.disk = extractMetric(diskRaw);
  }

  const wafEvents      = gcEvents(gcWafResult);
  const botEvents      = gcEvents(gcBotResult);
  const firewallEvents = gcEvents(gcFirewallResult);

  const attackCategoryMap: Record<string, number> = {};
  for (const e of wafEvents) {
    for (const a of (e.alerts ?? [])) {
      const cat = classifyAlert(a.msg, a.id);
      attackCategoryMap[cat] = (attackCategoryMap[cat] ?? 0) + 1;
    }
  }

  const toolMap: Record<string, number> = {};
  for (const e of [...wafEvents, ...botEvents]) {
    const tool = detectTool(e.user_agent ?? "");
    toolMap[tool] = (toolMap[tool] ?? 0) + 1;
  }

  const countryMap: Record<string, number> = {};
  for (const e of [...wafEvents, ...botEvents, ...firewallEvents]) {
    if (e.country_code) countryMap[e.country_code] = (countryMap[e.country_code] ?? 0) + 1;
  }
  const topCountries = Object.entries(countryMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const auditSummaries = [
    processLokiAudit("Integra",      lokiIntegraResult),
    processLokiAudit("customer360",  lokiC360Result),
    processLokiAudit("fieldservice", lokiFsResult),
  ];
  const auditTotal       = auditSummaries.reduce((s, a) => s + a.total, 0);
  const auditUnmasked    = auditSummaries.reduce((s, a) => s + a.unmasked, 0);
  const auditExternalIPs = [...new Set(auditSummaries.flatMap(a => a.externalIPs))];

  const firingAlerts   = grafanaAlertsResult.status === "fulfilled" ? grafanaAlertsResult.value : [];
  const criticalAlerts = firingAlerts.filter(a => a.severity === "critical");
  const downDeps       = grafanaDownResult.status === "fulfilled"
    ? grafanaDownResult.value.map(r => r.metric.deployment).filter(Boolean)
    : [];

  const slos = ddSloResult.status === "fulfilled"
    ? ((ddSloResult.value as Record<string, unknown>)?.data ?? []) as SloEntry[]
    : [];
  const breachedSlos = slos.filter(s => {
    const rem = s.status?.error_budget_remaining;
    return typeof rem === "number" && rem < 0.1;
  });

  const nowMin = Math.floor(Date.now() / MS_PER_MINUTE);
  const anomalies = anomalyDetectors.flatMap(detect => detect(seqEvents, nowMin));
  const anomalyProblems = correlateProblems(anomalies);

  return {
    seqEvents, authFails,
    monitors, alertMonitors, activeIncidents,
    infra,
    wafEvents, botEvents, firewallEvents,
    gcBlockedTotal: wafEvents.length + botEvents.length + firewallEvents.length,
    attackCategoryMap, toolMap, topCountries,
    auditSummaries, auditTotal, auditUnmasked, auditExternalIPs,
    firingAlerts, criticalAlerts, downDeps,
    breachedSlos,
    anomalyProblems,
    sources: { seqOk, ddOk, gcOk },
  };
}

type Rule = (ctx: ThreatContext) => CorrelatedThreat | null;

const ruleBruteForce: Rule = (ctx) => {
  const bfMap: Record<string, Date[]> = {};
  for (const e of ctx.authFails) {
    const u = emailFrom(e.message || "");
    if (!u) continue;
    (bfMap[u] ??= []).push(new Date(e.timestamp));
  }
  const hits = Object.entries(bfMap).filter(([, ts]) => {
    if (ts.length < 5) return false;
    const s = ts.sort((a, b) => a.getTime() - b.getTime());
    return s[s.length - 1].getTime() - s[0].getTime() < 600_000;
  });
  if (hits.length === 0) return null;
  return {
    rule: "BRUTE_FORCE",
    title: "Ataque de Força Bruta Detectado",
    description: `${hits.length} usuário(s) com ≥5 falhas de autenticação em janela de 10 minutos.`,
    risk: hits.length > 3 ? "HIGH" : "MEDIUM",
    evidence: hits.slice(0, 5).map(([u, ts]) => `${u}: ${ts.length} tentativas`),
    indicators: hits.slice(0, 5).map(([u]) => u),
  };
};

const ruleWafInjection: Rule = (ctx) => {
  const count = (ctx.attackCategoryMap.SQLi ?? 0) + (ctx.attackCategoryMap.XSS ?? 0);
  if (count === 0) return null;
  const isInjectionEvent = (e: GcRawEvent) =>
    e.alerts?.some(a => ["SQLi", "XSS"].includes(classifyAlert(a.msg, a.id)));
  const topURIs = [...new Set(ctx.wafEvents.filter(isInjectionEvent).map(e => e.uri?.split("?")[0]))].slice(0, 5);
  const topIPs  = [...new Set(ctx.wafEvents.filter(isInjectionEvent).map(e => e.ip))].slice(0, 5);
  return {
    rule: "WAF_INJECTION",
    title: "Tentativas de Injeção (SQLi/XSS) Bloqueadas",
    description: `${count} eventos WAF com padrões de injeção nas últimas 24h (SQLi: ${ctx.attackCategoryMap.SQLi ?? 0}, XSS: ${ctx.attackCategoryMap.XSS ?? 0}).`,
    risk: count > 20 ? "CRITICAL" : "HIGH",
    evidence: [
      `Endpoints: ${topURIs.join(", ") || "(diversos)"}`,
      `IPs ofensores: ${topIPs.join(", ") || "(desconhecidos)"}`,
      ...Object.entries(ctx.attackCategoryMap).filter(([k]) => k !== "Other").map(([k, v]) => `${k}: ${v} eventos`),
    ],
    indicators: topIPs,
  };
};

const ruleMultiSourceIp: Rule = (ctx) => {
  const allGc = [...ctx.wafEvents, ...ctx.botEvents, ...ctx.firewallEvents];
  const gcIPs  = new Set(allGc.map(e => e.ip).filter(Boolean));
  const seqIPs = new Set(
    ctx.seqEvents
      .map(e => e.message?.match(/\b([0-9]{1,3}(?:\.[0-9]{1,3}){3})\b/)?.[1])
      .filter((ip): ip is string => Boolean(ip)),
  );
  const multi = [...gcIPs].filter(ip => seqIPs.has(ip));
  if (multi.length === 0) return null;
  return {
    rule: "MULTI_SOURCE_IP",
    title: "IPs Atacando Múltiplas Camadas",
    description: `${multi.length} IP(s) aparecem tanto no WAF/Firewall quanto nos logs de aplicação.`,
    risk: "HIGH",
    evidence: multi.slice(0, 5).map(ip => `${ip}: bloqueado WAF + log app`),
    indicators: multi.slice(0, 5),
  };
};

const ruleDatadogAlert: Rule = (ctx) => {
  if (ctx.alertMonitors.length === 0) return null;
  const names = ctx.alertMonitors.slice(0, 5).map(m => String(m.name));
  return {
    rule: "DATADOG_ALERT",
    title: "Monitores Datadog em Alerta",
    description: `${ctx.alertMonitors.length} monitor(es) em estado Alert/Warn ativos no Datadog.`,
    risk: ctx.alertMonitors.some(m => String(m.overall_state) === "Alert") ? "HIGH" : "MEDIUM",
    evidence: names.map(n => `Monitor: ${n}`),
    indicators: names,
  };
};

const ruleHighErrorRate: Rule = (ctx) => {
  const cutoff = Date.now() - 3_600_000;
  const recent = ctx.seqEvents.filter(e =>
    (e.level === "Error" || e.level === "Critical") && new Date(e.timestamp).getTime() >= cutoff,
  );
  if (recent.length <= 50) return null;
  const pathCount: Record<string, number> = {};
  for (const e of recent) {
    if (e.request_path) pathCount[e.request_path] = (pathCount[e.request_path] ?? 0) + 1;
  }
  const topPaths = Object.entries(pathCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    rule: "HIGH_ERROR_RATE",
    title: "Taxa Elevada de Erros na Última Hora",
    description: `${recent.length} erros/críticos registrados na última hora.`,
    risk: recent.length > 200 ? "HIGH" : "MEDIUM",
    evidence: topPaths.map(([p, c]) => `${p}: ${c} erros`),
    indicators: topPaths.map(([p]) => p),
  };
};

const ruleActiveIncident: Rule = (ctx) => {
  if (ctx.activeIncidents.length === 0) return null;
  const titles = ctx.activeIncidents.slice(0, 5).map(i => String(i.attributes.title || "(sem título)"));
  return {
    rule: "ACTIVE_INCIDENT",
    title: "Incidentes Ativos no Datadog",
    description: `${ctx.activeIncidents.length} incidente(s) ativo(s) registrado(s) no Datadog (não resolvido).`,
    risk: ctx.activeIncidents.length >= 2 ? "CRITICAL" : "HIGH",
    evidence: titles.map(t => `Incidente: ${t}`),
    indicators: titles,
  };
};

const AGGRESSIVE_TOOLS = ["SQLMap", "Nikto", "Dart"];
const ruleScannerDetected: Rule = (ctx) => {
  const hits = AGGRESSIVE_TOOLS.flatMap(t => ctx.toolMap[t] ? [`${t}: ${ctx.toolMap[t]} requisições`] : []);
  if (hits.length === 0) return null;
  const total = AGGRESSIVE_TOOLS.reduce((s, t) => s + (ctx.toolMap[t] ?? 0), 0);
  return {
    rule: "SCANNER_DETECTED",
    title: "Ferramentas de Scanning Ofensivo Detectadas",
    description: `${total} requisições de ferramentas de hacking ativo detectadas pelo WAF (${hits.join(", ")}).`,
    risk: (ctx.toolMap.SQLMap ?? 0) > 5 || (ctx.toolMap.Nikto ?? 0) > 5 ? "CRITICAL" : "HIGH",
    evidence: [
      ...hits,
      `Path Traversal: ${ctx.attackCategoryMap.PathTraversal ?? 0} tentativas`,
      `Scanner WAF: ${ctx.attackCategoryMap.Scanner ?? 0} eventos`,
    ],
    indicators: AGGRESSIVE_TOOLS.filter(t => ctx.toolMap[t]),
  };
};

const ruleBotAttack: Rule = (ctx) => {
  if (ctx.botEvents.length <= 100) return null;
  const ipCount: Record<string, number> = {};
  for (const e of ctx.botEvents) ipCount[e.ip] = (ipCount[e.ip] ?? 0) + 1;
  const topIPs = Object.entries(ipCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    rule: "BOT_ATTACK",
    title: "Volume Elevado de Bots Maliciosos",
    description: `${ctx.botEvents.length} requisições de bots bloqueadas nas últimas 24h.`,
    risk: ctx.botEvents.length > 500 ? "HIGH" : "MEDIUM",
    evidence: topIPs.map(([ip, c]) => `${ip}: ${c} requisições bot`),
    indicators: topIPs.map(([ip]) => ip),
  };
};

const ruleInfraStress: Rule = (ctx) => {
  const highCpu  = ctx.infra.cpu.filter(s => s.value > 85);
  const highDisk = ctx.infra.disk.filter(s => s.value > 90);
  const restarts = ctx.infra.podRestarts;
  if (highCpu.length === 0 && highDisk.length === 0 && restarts.length === 0) return null;
  const evidence: string[] = [];
  evidence.push(...highCpu.slice(0, 3).map(s => `CPU ${s.value}% — ${s.scope.replace("host:", "")}`));
  evidence.push(...highDisk.slice(0, 3).map(s => `Disco ${s.value}% — ${s.scope.replace("host:", "")}`));
  evidence.push(...restarts.slice(0, 3).map(s => `${s.scope.replace("kube_deployment:", "")} reiniciou ${Math.round(s.value)}x`));
  return {
    rule: "INFRA_STRESS",
    title: "Estresse de Infraestrutura Detectado",
    description: `${highCpu.length} host(s) com CPU>85%, ${highDisk.length} com disco>90%, ${restarts.length} deployment(s) com reinicializações de pods.`,
    risk: highCpu.length > 3 || restarts.length > 5 ? "HIGH" : "MEDIUM",
    evidence,
    indicators: [
      ...highCpu.slice(0, 3).map(s => s.scope.replace("host:", "")),
      ...restarts.slice(0, 3).map(s => s.scope.replace("kube_deployment:", "")),
    ],
  };
};

const SUSPICIOUS_COUNTRIES = ["CN", "RU", "KP", "IR", "BR"];
const ruleGeoConcentration: Rule = (ctx) => {
  const hits = ctx.topCountries.filter(([cc]) => SUSPICIOUS_COUNTRIES.includes(cc));
  if (hits.length === 0 || ctx.gcBlockedTotal <= 50) return null;
  return {
    rule: "GEO_CONCENTRATION",
    title: "Concentração Geográfica de Ataques",
    description: `Ataques concentrados em ${hits.length} país(es) com histórico de ameaças: ${hits.map(([cc, n]) => `${cc}(${n})`).join(", ")}.`,
    risk: "MEDIUM",
    evidence: ctx.topCountries.map(([cc, n]) => `${cc}: ${n} eventos bloqueados`),
    indicators: hits.map(([cc]) => cc),
  };
};

const rulePrometheusAlert: Rule = (ctx) => {
  const warningCount = ctx.firingAlerts.filter(a => a.severity === "warning").length;
  if (ctx.criticalAlerts.length === 0 && warningCount <= 3) return null;
  return {
    rule: "PROMETHEUS_ALERT",
    title: "Alertas Críticos no Prometheus/Alertmanager",
    description: `${ctx.criticalAlerts.length} alerta(s) crítico(s) e ${ctx.firingAlerts.length} total disparado(s) no Prometheus.`,
    risk: ctx.criticalAlerts.length > 0 ? "HIGH" : "MEDIUM",
    evidence: ctx.firingAlerts.slice(0, 5).map(a => `[${a.severity}] ${a.name}${a.namespace ? " (ns: " + a.namespace + ")" : ""}`),
    indicators: ctx.firingAlerts.slice(0, 5).map(a => a.name),
  };
};

const ruleDeploymentDown: Rule = (ctx) => {
  if (ctx.downDeps.length === 0) return null;
  return {
    rule: "DEPLOYMENT_DOWN",
    title: "Deployments Kubernetes com Zero Réplicas",
    description: `${ctx.downDeps.length} deployment(s) no namespace integra-prd com 0 réplicas disponíveis.`,
    risk: ctx.downDeps.length > 5 ? "MEDIUM" : "LOW",
    evidence: ctx.downDeps.slice(0, 8).map(d => `Parado: ${d}`),
    indicators: ctx.downDeps.slice(0, 8),
  };
};

const ruleAuditAnomaly: Rule = (ctx) => {
  const highVolume = ctx.auditSummaries.flatMap(s =>
    s.topUsers.filter(u => u.count > 200).map(u => `${u.userId} (${s.service}): ${u.count} acessos`),
  );
  if (ctx.auditUnmasked <= 30 && highVolume.length === 0) return null;
  const services = ctx.auditSummaries.filter(s => s.total > 0).map(s => s.service).join(", ");
  return {
    rule: "AUDIT_ANOMALY",
    title: "Anomalia de Acesso a Dados Sensíveis",
    description: `${ctx.auditUnmasked} acessos a dados reais (desmascarados) detectados na auditoria de ${services}.`,
    risk: ctx.auditUnmasked > 200 ? "HIGH" : "MEDIUM",
    evidence: [
      ...ctx.auditSummaries.map(s => `${s.service}: ${s.total} eventos auditoria, ${s.unmasked} dados reais`),
      ...highVolume.slice(0, 3),
    ],
    indicators: highVolume.slice(0, 5).map(u => u.split(" ")[0]),
  };
};

const ruleExternalAuditIp: Rule = (ctx) => {
  if (ctx.auditExternalIPs.length === 0) return null;
  return {
    rule: "EXTERNAL_AUDIT_IP",
    title: "Acessos a Serviços via IPs Externos",
    description: `${ctx.auditExternalIPs.length} IP(s) externo(s) detectado(s) nos logs de auditoria (Integra, customer360, fieldservice).`,
    risk: "HIGH",
    evidence: ctx.auditExternalIPs.slice(0, 5).map(ip => `IP externo: ${ip}`),
    indicators: ctx.auditExternalIPs.slice(0, 5),
  };
};

const ruleSloBreach: Rule = (ctx) => {
  if (ctx.breachedSlos.length === 0) return null;
  return {
    rule: "SLO_BREACH",
    title: "SLOs com Budget de Erros Esgotado",
    description: `${ctx.breachedSlos.length} SLO(s) com budget de erros abaixo de 10% no Datadog.`,
    risk: "HIGH",
    evidence: ctx.breachedSlos.slice(0, 5).map(s => `${s.name}: ${Math.round((s.status?.error_budget_remaining ?? 0) * 100)}% budget restante`),
    indicators: ctx.breachedSlos.slice(0, 5).map(s => s.name),
  };
};

const ruleCriticalAnomaly: Rule = (ctx) => {
  const critical = ctx.anomalyProblems.filter(p => p.severity === "CRITICAL" || p.severity === "HIGH");
  if (critical.length === 0) return null;
  const top = critical.slice(0, 5);
  return {
    rule: "ANOMALY_DETECTED",
    title: "Anomalias Detectadas (Davis-style)",
    description: `${critical.length} problema(s) detectado(s) por análise estatística (P99+IQR sobre 7d): ${critical.filter(p => p.severity === "CRITICAL").length} crítico(s), ${critical.filter(p => p.severity === "HIGH").length} alto(s).`,
    risk: critical.some(p => p.severity === "CRITICAL") ? "CRITICAL" : "HIGH",
    evidence: top.map(p => `[${p.severity}] ${p.rootDimension}: ${p.anomalies[0]?.evidence[0] ?? "—"}`),
    indicators: top.map(p => p.rootDimension),
  };
};

export const rules: Rule[] = [
  ruleBruteForce, ruleWafInjection, ruleMultiSourceIp, ruleDatadogAlert,
  ruleHighErrorRate, ruleActiveIncident, ruleScannerDetected, ruleBotAttack,
  ruleInfraStress, ruleGeoConcentration, rulePrometheusAlert, ruleDeploymentDown,
  ruleAuditAnomaly, ruleExternalAuditIp, ruleSloBreach,
  ruleCriticalAnomaly,
];

export function buildPrompt(
  ctx: ThreatContext,
  findings: CorrelatedThreat[],
  overallRisk: RiskLevel,
): string {
  const summaryLines = findings.length > 0
    ? findings.map(f => `- [${f.risk}] ${f.title}: ${f.description}`).join("\n")
    : "Nenhuma ameaça crítica identificada no período.";

  const gcSummary = [
    `WAF bloqueado: ${ctx.wafEvents.length}`,
    `Bots bloqueados: ${ctx.botEvents.length}`,
    `Firewall: ${ctx.firewallEvents.length}`,
    Object.entries(ctx.attackCategoryMap).filter(([k]) => k !== "Other").map(([k, v]) => `${k}: ${v}`).join(", "),
    ctx.toolMap.SQLMap ? `SQLMap detectado: ${ctx.toolMap.SQLMap} tentativas` : "",
    ctx.toolMap.Nikto  ? `Nikto detectado: ${ctx.toolMap.Nikto} tentativas`  : "",
    ctx.topCountries.length ? `Top países: ${ctx.topCountries.map(([cc, n]) => `${cc}(${n})`).join(", ")}` : "",
  ].filter(Boolean).join(" | ");

  const ddSummary = [
    `Monitores em alerta: ${ctx.alertMonitors.length}`,
    ctx.activeIncidents.length ? `Incidentes ativos: ${ctx.activeIncidents.length}` : "",
    ctx.infra.cpu.filter(s => s.value > 85).length ? `Hosts CPU>85%: ${ctx.infra.cpu.filter(s => s.value > 85).length}` : "",
    ctx.infra.podRestarts.length ? `Pods reiniciando: ${ctx.infra.podRestarts.length}` : "",
  ].filter(Boolean).join(" | ");

  const auditSummaryLine = ctx.auditSummaries
    .filter(s => s.total > 0)
    .map(s => `${s.service}: ${s.total} eventos, ${s.unmasked} dados reais`)
    .join(" | ") || "sem dados";

  return `Você é um analista de segurança cibernética sênior. Com base nos dados coletados do ecossistema Ituran (plataforma integra-prd) nas últimas 24 horas, elabore um relatório executivo em português (máximo 400 palavras).

MÉTRICAS DO PERÍODO:
- Logs Seq: ${ctx.seqEvents.length} eventos (${ctx.authFails.length} falhas de autenticação)
- Auditoria (Integra, customer360, fieldservice): ${ctx.auditTotal} eventos — ${auditSummaryLine}${ctx.auditExternalIPs.length > 0 ? ` — ${ctx.auditExternalIPs.length} IPs externos` : ""}
- Datadog: ${ddSummary}${ctx.breachedSlos.length > 0 ? ` | SLOs em breach: ${ctx.breachedSlos.length}` : ""}
- GoCache WAF/Bot/Firewall: ${gcSummary}
- Kubernetes: ${ctx.criticalAlerts.length} alertas críticos, ${ctx.downDeps.length} deployments parados
- Nível de risco geral: ${overallRisk}

AMEAÇAS CORRELACIONADAS (${findings.length} regras disparadas):
${summaryLines}

Estruture o relatório em 4 seções curtas:
1. **Resumo Executivo** (2-3 frases sobre o estado atual)
2. **Ameaças Prioritárias** (máx 3 bullets com contexto de risco)
3. **Recomendações Imediatas** (máx 3 ações concretas)
4. **Avaliação de Risco** (sentença final com nível e tendência)

Seja direto e objetivo. Evite jargão técnico excessivo.`;
}
