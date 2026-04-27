"use server";
import { createServerFn } from "@tanstack/react-start";
import { getEvents } from "../../../backend/src/accumulator";
import { gcFetch } from "../../../backend/src/lib/gcClient";
import { ddFetch } from "../../../backend/src/lib/ddClient";
import { aiNarrative } from "../../../backend/src/lib/aiClient";
import { grafanaPromQuery, grafanaFiringAlerts } from "../../../backend/src/lib/grafanaClient";
import { lokiQueryRange } from "../../../backend/src/lib/lokiClient";
import type { LokiStream } from "../../../backend/src/lib/lokiClient";

type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

interface CorrelatedThreat {
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

function maxRisk(findings: CorrelatedThreat[]): RiskLevel {
  if (findings.length === 0) return "INFO";
  return findings.reduce(
    (max, f) => (RISK_ORDER[f.risk] > RISK_ORDER[max] ? f.risk : max),
    "INFO" as RiskLevel,
  );
}

function emailFrom(msg: string): string | null {
  return msg?.match(/User:\s*(\S+)\s*\|/)?.[1] ?? null;
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

export const getThreatReport = createServerFn({ method: "GET" }).handler(async () => {
  const now    = Math.floor(Date.now() / 1000);
  const from24 = now - 86400;
  const toNsLoki   = Date.now() * 1_000_000;
  const fromNsLoki = (Date.now() - 86_400_000) * 1_000_000;

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
    gcFetch("/v1/threat-hub/events", "POST", {
      start_date: from24, end_date: now, type: ["waf"], action: ["block"], limit: 200,
    }),
    gcFetch("/v1/threat-hub/events", "POST", {
      start_date: from24, end_date: now, type: ["bot-mitigation"], action: ["block"], limit: 200,
    }),
    gcFetch("/v1/threat-hub/events", "POST", {
      start_date: from24, end_date: now, type: ["firewall"], action: ["block"], limit: 200,
    }),
    Promise.all([
      ddFetch(`/api/v1/query?from=${now - 3600}&to=${now}&query=${encodeURIComponent("avg:system.cpu.user{*}by{host}")}`),
      ddFetch(`/api/v1/query?from=${now - 3600}&to=${now}&query=${encodeURIComponent("sum:kubernetes.containers.restarts{*}by{kube_deployment}")}`),
      ddFetch(`/api/v1/query?from=${now - 3600}&to=${now}&query=${encodeURIComponent("avg:system.disk.in_use{*}by{host}")}`),
    ]),
    grafanaFiringAlerts(),
    grafanaPromQuery('kube_deployment_status_replicas_available{namespace="integra-prd"} == 0'),
    lokiQueryRange('{app="Integra",log_type="audit"}',      fromNsLoki, toNsLoki, 500),
    lokiQueryRange('{app="customer360",log_type="audit"}',  fromNsLoki, toNsLoki, 500),
    lokiQueryRange('{app="fieldservice",log_type="audit"}', fromNsLoki, toNsLoki, 500),
    ddFetch("/api/v1/slo?limit=100"),
  ]);

  const seqOk = seqResult.status === "fulfilled";
  const ddOk  = ddMonitorsResult.status === "fulfilled";
  const gcOk  = gcWafResult.status === "fulfilled";

  const seqEvents = seqOk ? seqResult.value : [];
  const monitors  = ddOk && Array.isArray(ddMonitorsResult.value)
    ? (ddMonitorsResult.value as Record<string, unknown>[])
    : [];

  type IncidentAttr = Record<string, unknown>;
  const rawIncidents = ddIncidentsResult.status === "fulfilled"
    ? (((ddIncidentsResult.value as Record<string, unknown>)?.data ?? []) as { attributes: IncidentAttr }[])
    : [];
  const activeIncidents = rawIncidents.filter(i => i.attributes?.resolved == null);

  type InfraMetrics = { cpu: { scope: string; value: number }[]; podRestarts: { scope: string; value: number }[]; disk: { scope: string; value: number }[] };
  const infraMetrics: InfraMetrics = { cpu: [], podRestarts: [], disk: [] };

  if (ddInfraResult.status === "fulfilled") {
    const [cpuRaw, podRaw, diskRaw] = ddInfraResult.value as unknown[];

    function extractMetric(raw: unknown): { scope: string; value: number }[] {
      const series = (((raw as Record<string, unknown>)?.series ?? []) as Record<string, unknown>[]);
      return series.map(s => {
        const pts = (s.pointlist ?? []) as [number, number | null][];
        const last = [...pts].reverse().find(p => p[1] !== null);
        return { scope: String(s.scope ?? ""), value: last ? Math.round(last[1]! * 10) / 10 : 0 };
      });
    }

    infraMetrics.cpu        = extractMetric(cpuRaw);
    infraMetrics.podRestarts = extractMetric(podRaw).filter(s => s.value > 0);
    infraMetrics.disk       = extractMetric(diskRaw);
  }

  type GcRawEvent = { ip: string; uri: string; user_agent?: string; country_code?: string; alerts: { id: string; msg: string; match?: string }[] };

  function gcEvents(result: PromiseSettledResult<unknown>): GcRawEvent[] {
    if (result.status !== "fulfilled") return [];
    const r = result.value as Record<string, unknown>;
    return (((r?.response as Record<string, unknown>)?.events ?? []) as GcRawEvent[]);
  }

  const wafEvents      = gcEvents(gcWafResult);
  const botEvents      = gcEvents(gcBotResult);
  const firewallEvents = gcEvents(gcFirewallResult);
  const allGcEvents    = [...wafEvents, ...botEvents, ...firewallEvents];
  const gcBlockedTotal = allGcEvents.length;

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
  for (const e of allGcEvents) {
    if (e.country_code) countryMap[e.country_code] = (countryMap[e.country_code] ?? 0) + 1;
  }
  const topCountries = Object.entries(countryMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // ── Loki audit processing ─────────────────────────────────────────────────
  interface AuditSummary {
    service: string; total: number; unmasked: number;
    externalIPs: string[]; topUsers: { userId: string; count: number }[];
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

  const auditSummaries = [
    processLokiAudit("Integra",      lokiIntegraResult),
    processLokiAudit("customer360",  lokiC360Result),
    processLokiAudit("fieldservice", lokiFsResult),
  ];
  const auditTotal    = auditSummaries.reduce((s, a) => s + a.total, 0);
  const auditUnmasked = auditSummaries.reduce((s, a) => s + a.unmasked, 0);
  const auditExternalIPs = [...new Set(auditSummaries.flatMap(a => a.externalIPs))];

  // ── SLO processing ────────────────────────────────────────────────────────
  type SloEntry = { name: string; status: { error_budget_remaining?: number } };
  const slos = ddSloResult.status === "fulfilled"
    ? ((ddSloResult.value as Record<string, unknown>)?.data ?? []) as SloEntry[]
    : [];
  const breachedSlos = slos.filter(s => {
    const rem = s.status?.error_budget_remaining;
    return typeof rem === "number" && rem < 0.1;
  });

  const findings: CorrelatedThreat[] = [];

  // Rule 1: BRUTE_FORCE
  const authFails = seqEvents.filter(e => e.message?.includes("Erro autenticação"));
  const bfMap: Record<string, Date[]> = {};
  for (const e of authFails) {
    const u = emailFrom(e.message || "");
    if (!u) continue;
    if (!bfMap[u]) bfMap[u] = [];
    bfMap[u].push(new Date(e.timestamp));
  }
  const bruteForceHits = Object.entries(bfMap).filter(([, ts]) => {
    if (ts.length < 5) return false;
    const s = ts.sort((a, b) => a.getTime() - b.getTime());
    return s[s.length - 1].getTime() - s[0].getTime() < 600_000;
  });
  if (bruteForceHits.length > 0) {
    findings.push({
      rule:        "BRUTE_FORCE",
      title:       "Ataque de Força Bruta Detectado",
      description: `${bruteForceHits.length} usuário(s) com ≥5 falhas de autenticação em janela de 10 minutos.`,
      risk:        bruteForceHits.length > 3 ? "HIGH" : "MEDIUM",
      evidence:    bruteForceHits.slice(0, 5).map(([u, ts]) => `${u}: ${ts.length} tentativas`),
      indicators:  bruteForceHits.slice(0, 5).map(([u]) => u),
    });
  }

  // Rule 2: WAF_INJECTION
  const injectionCount = (attackCategoryMap["SQLi"] ?? 0) + (attackCategoryMap["XSS"] ?? 0);
  if (injectionCount > 0) {
    const topURIs = [...new Set(wafEvents
      .filter(e => e.alerts?.some(a => ["SQLi","XSS"].includes(classifyAlert(a.msg, a.id))))
      .map(e => e.uri?.split("?")[0]))].slice(0, 5);
    const topIPs = [...new Set(wafEvents
      .filter(e => e.alerts?.some(a => ["SQLi","XSS"].includes(classifyAlert(a.msg, a.id))))
      .map(e => e.ip))].slice(0, 5);
    findings.push({
      rule:        "WAF_INJECTION",
      title:       "Tentativas de Injeção (SQLi/XSS) Bloqueadas",
      description: `${injectionCount} eventos WAF com padrões de injeção nas últimas 24h (SQLi: ${attackCategoryMap["SQLi"] ?? 0}, XSS: ${attackCategoryMap["XSS"] ?? 0}).`,
      risk:        injectionCount > 20 ? "CRITICAL" : "HIGH",
      evidence:    [
        `Endpoints: ${topURIs.join(", ") || "(diversos)"}`,
        `IPs ofensores: ${topIPs.join(", ") || "(desconhecidos)"}`,
        ...Object.entries(attackCategoryMap)
          .filter(([k]) => k !== "Other")
          .map(([k, v]) => `${k}: ${v} eventos`),
      ],
      indicators:  topIPs,
    });
  }

  // Rule 4: MULTI_SOURCE_IP
  const gcIPSet  = new Set(allGcEvents.map(e => e.ip).filter(Boolean));
  const seqIPSet = new Set(
    seqEvents
      .map(e => e.message?.match(/\b([0-9]{1,3}(?:\.[0-9]{1,3}){3})\b/)?.[1])
      .filter((ip): ip is string => Boolean(ip))
  );
  const multiSourceIPs = [...gcIPSet].filter(ip => seqIPSet.has(ip));
  if (multiSourceIPs.length > 0) {
    findings.push({
      rule:        "MULTI_SOURCE_IP",
      title:       "IPs Atacando Múltiplas Camadas",
      description: `${multiSourceIPs.length} IP(s) aparecem tanto no WAF/Firewall quanto nos logs de aplicação.`,
      risk:        "HIGH",
      evidence:    multiSourceIPs.slice(0, 5).map(ip => `${ip}: bloqueado WAF + log app`),
      indicators:  multiSourceIPs.slice(0, 5),
    });
  }

  // Rule 5: DATADOG_ALERT
  const alertMonitors = monitors.filter(m => {
    const state = String(m.overall_state ?? "");
    return (state === "Alert" || state === "Warn") && !String(m.name ?? "").startsWith("[license]");
  });
  if (alertMonitors.length > 0) {
    const names = alertMonitors.slice(0, 5).map(m => String(m.name));
    findings.push({
      rule:        "DATADOG_ALERT",
      title:       "Monitores Datadog em Alerta",
      description: `${alertMonitors.length} monitor(es) em estado Alert/Warn ativos no Datadog.`,
      risk:        alertMonitors.some(m => String(m.overall_state) === "Alert") ? "HIGH" : "MEDIUM",
      evidence:    names.map(n => `Monitor: ${n}`),
      indicators:  names,
    });
  }

  // Rule 7: HIGH_ERROR_RATE
  const recentErrors = seqEvents.filter(e => {
    if (e.level !== "Error" && e.level !== "Critical") return false;
    return new Date(e.timestamp) >= new Date(Date.now() - 3_600_000);
  });
  if (recentErrors.length > 50) {
    const topPaths = Object.entries(
      recentErrors.reduce((acc, e) => {
        if (e.request_path) acc[e.request_path] = (acc[e.request_path] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).sort((a, b) => b[1] - a[1]).slice(0, 5);
    findings.push({
      rule:        "HIGH_ERROR_RATE",
      title:       "Taxa Elevada de Erros na Última Hora",
      description: `${recentErrors.length} erros/críticos registrados na última hora.`,
      risk:        recentErrors.length > 200 ? "HIGH" : "MEDIUM",
      evidence:    topPaths.map(([p, c]) => `${p}: ${c} erros`),
      indicators:  topPaths.map(([p]) => p),
    });
  }

  // Rule 8: ACTIVE_INCIDENT
  if (activeIncidents.length > 0) {
    const titles = activeIncidents.slice(0, 5).map(i => String(i.attributes.title || "(sem título)"));
    findings.push({
      rule:        "ACTIVE_INCIDENT",
      title:       "Incidentes Ativos no Datadog",
      description: `${activeIncidents.length} incidente(s) ativo(s) registrado(s) no Datadog (não resolvido).`,
      risk:        activeIncidents.length >= 2 ? "CRITICAL" : "HIGH",
      evidence:    titles.map(t => `Incidente: ${t}`),
      indicators:  titles,
    });
  }

  // Rule 9: SCANNER_DETECTED
  const aggressiveTools = ["SQLMap", "Nikto", "Dart"];
  const scannerHits = aggressiveTools.flatMap(tool =>
    toolMap[tool] ? [`${tool}: ${toolMap[tool]} requisições`] : []
  );
  if (scannerHits.length > 0) {
    const totalScans = aggressiveTools.reduce((s, t) => s + (toolMap[t] ?? 0), 0);
    findings.push({
      rule:        "SCANNER_DETECTED",
      title:       "Ferramentas de Scanning Ofensivo Detectadas",
      description: `${totalScans} requisições de ferramentas de hacking ativo detectadas pelo WAF (${scannerHits.join(", ")}).`,
      risk:        (toolMap["SQLMap"] ?? 0) > 5 || (toolMap["Nikto"] ?? 0) > 5 ? "CRITICAL" : "HIGH",
      evidence:    [
        ...scannerHits,
        `Path Traversal: ${attackCategoryMap["PathTraversal"] ?? 0} tentativas`,
        `Scanner WAF: ${attackCategoryMap["Scanner"] ?? 0} eventos`,
      ],
      indicators:  aggressiveTools.filter(t => toolMap[t]),
    });
  }

  // Rule 10: BOT_ATTACK
  if (botEvents.length > 100) {
    const topBotIPs = Object.entries(
      botEvents.reduce((acc, e) => { acc[e.ip] = (acc[e.ip] ?? 0) + 1; return acc; }, {} as Record<string, number>)
    ).sort((a, b) => b[1] - a[1]).slice(0, 5);
    findings.push({
      rule:        "BOT_ATTACK",
      title:       "Volume Elevado de Bots Maliciosos",
      description: `${botEvents.length} requisições de bots bloqueadas nas últimas 24h.`,
      risk:        botEvents.length > 500 ? "HIGH" : "MEDIUM",
      evidence:    topBotIPs.map(([ip, c]) => `${ip}: ${c} requisições bot`),
      indicators:  topBotIPs.map(([ip]) => ip),
    });
  }

  // Rule 11: INFRA_STRESS
  const highCpuHosts   = infraMetrics.cpu.filter(s => s.value > 85);
  const highDiskHosts  = infraMetrics.disk.filter(s => s.value > 90);
  const podRestartHosts = infraMetrics.podRestarts;
  if (highCpuHosts.length > 0 || podRestartHosts.length > 0 || highDiskHosts.length > 0) {
    const evidence: string[] = [];
    if (highCpuHosts.length > 0)
      evidence.push(...highCpuHosts.slice(0, 3).map(s => `CPU ${s.value}% — ${s.scope.replace("host:", "")}`));
    if (highDiskHosts.length > 0)
      evidence.push(...highDiskHosts.slice(0, 3).map(s => `Disco ${s.value}% — ${s.scope.replace("host:", "")}`));
    if (podRestartHosts.length > 0)
      evidence.push(...podRestartHosts.slice(0, 3).map(s => `${s.scope.replace("kube_deployment:", "")} reiniciou ${Math.round(s.value)}x`));
    findings.push({
      rule:        "INFRA_STRESS",
      title:       "Estresse de Infraestrutura Detectado",
      description: `${highCpuHosts.length} host(s) com CPU>85%, ${highDiskHosts.length} com disco>90%, ${podRestartHosts.length} deployment(s) com reinicializações de pods.`,
      risk:        highCpuHosts.length > 3 || podRestartHosts.length > 5 ? "HIGH" : "MEDIUM",
      evidence,
      indicators:  [
        ...highCpuHosts.slice(0, 3).map(s => s.scope.replace("host:", "")),
        ...podRestartHosts.slice(0, 3).map(s => s.scope.replace("kube_deployment:", "")),
      ],
    });
  }

  // Rule 12: GEO_CONCENTRATION
  const suspiciousCountries = ["CN", "RU", "KP", "IR", "BR"];
  const geoHits = topCountries.filter(([cc]) => suspiciousCountries.includes(cc));
  if (geoHits.length > 0 && gcBlockedTotal > 50) {
    findings.push({
      rule:        "GEO_CONCENTRATION",
      title:       "Concentração Geográfica de Ataques",
      description: `Ataques concentrados em ${geoHits.length} país(es) com histórico de ameaças: ${geoHits.map(([cc, n]) => `${cc}(${n})`).join(", ")}.`,
      risk:        "MEDIUM",
      evidence:    topCountries.map(([cc, n]) => `${cc}: ${n} eventos bloqueados`),
      indicators:  geoHits.map(([cc]) => cc),
    });
  }

  // Grafana results
  const firingAlerts  = grafanaAlertsResult.status === "fulfilled" ? grafanaAlertsResult.value : [];
  const criticalAlerts = firingAlerts.filter(a => a.severity === "critical");

  const downDeps = grafanaDownResult.status === "fulfilled"
    ? grafanaDownResult.value.map(r => r.metric.deployment).filter(Boolean)
    : [];

  // Rule 13: PROMETHEUS_ALERT
  if (criticalAlerts.length > 0 || firingAlerts.filter(a => a.severity === "warning").length > 3) {
    findings.push({
      rule:        "PROMETHEUS_ALERT",
      title:       "Alertas Críticos no Prometheus/Alertmanager",
      description: `${criticalAlerts.length} alerta(s) crítico(s) e ${firingAlerts.length} total disparado(s) no Prometheus.`,
      risk:        criticalAlerts.length > 0 ? "HIGH" : "MEDIUM",
      evidence:    firingAlerts.slice(0, 5).map(a => `[${a.severity}] ${a.name}${a.namespace ? " (ns: " + a.namespace + ")" : ""}`),
      indicators:  firingAlerts.slice(0, 5).map(a => a.name),
    });
  }

  // Rule 14: DEPLOYMENT_DOWN
  if (downDeps.length > 0) {
    findings.push({
      rule:        "DEPLOYMENT_DOWN",
      title:       "Deployments Kubernetes com Zero Réplicas",
      description: `${downDeps.length} deployment(s) no namespace integra-prd com 0 réplicas disponíveis.`,
      risk:        downDeps.length > 5 ? "MEDIUM" : "LOW",
      evidence:    downDeps.slice(0, 8).map(d => `Parado: ${d}`),
      indicators:  downDeps.slice(0, 8),
    });
  }

  // Rule 15: AUDIT_ANOMALY
  const auditHighVolume = auditSummaries.flatMap(s =>
    s.topUsers.filter(u => u.count > 200).map(u => `${u.userId} (${s.service}): ${u.count} acessos`)
  );
  if (auditUnmasked > 30 || auditHighVolume.length > 0) {
    findings.push({
      rule:        "AUDIT_ANOMALY",
      title:       "Anomalia de Acesso a Dados Sensíveis",
      description: `${auditUnmasked} acessos a dados reais (desmascarados) detectados na auditoria de ${auditSummaries.filter(s => s.total > 0).map(s => s.service).join(", ")}.`,
      risk:        auditUnmasked > 200 ? "HIGH" : "MEDIUM",
      evidence:    [
        ...auditSummaries.map(s => `${s.service}: ${s.total} eventos auditoria, ${s.unmasked} dados reais`),
        ...auditHighVolume.slice(0, 3),
      ],
      indicators:  auditHighVolume.slice(0, 5).map(u => u.split(" ")[0]),
    });
  }

  // Rule 16: EXTERNAL_AUDIT_IP
  if (auditExternalIPs.length > 0) {
    findings.push({
      rule:        "EXTERNAL_AUDIT_IP",
      title:       "Acessos a Serviços via IPs Externos",
      description: `${auditExternalIPs.length} IP(s) externo(s) detectado(s) nos logs de auditoria (Integra, customer360, fieldservice).`,
      risk:        "HIGH",
      evidence:    auditExternalIPs.slice(0, 5).map(ip => `IP externo: ${ip}`),
      indicators:  auditExternalIPs.slice(0, 5),
    });
  }

  // Rule 17: SLO_BREACH
  if (breachedSlos.length > 0) {
    findings.push({
      rule:        "SLO_BREACH",
      title:       "SLOs com Budget de Erros Esgotado",
      description: `${breachedSlos.length} SLO(s) com budget de erros abaixo de 10% no Datadog.`,
      risk:        "HIGH",
      evidence:    breachedSlos.slice(0, 5).map(s => `${s.name}: ${Math.round((s.status?.error_budget_remaining ?? 0) * 100)}% budget restante`),
      indicators:  breachedSlos.slice(0, 5).map(s => s.name),
    });
  }

  const overallRisk = maxRisk(findings);

  const summaryLines = findings.length > 0
    ? findings.map(f => `- [${f.risk}] ${f.title}: ${f.description}`).join("\n")
    : "Nenhuma ameaça crítica identificada no período.";

  const gcSummary = [
    `WAF bloqueado: ${wafEvents.length}`,
    `Bots bloqueados: ${botEvents.length}`,
    `Firewall: ${firewallEvents.length}`,
    Object.entries(attackCategoryMap).filter(([k]) => k !== "Other").map(([k, v]) => `${k}: ${v}`).join(", "),
    toolMap["SQLMap"] ? `SQLMap detectado: ${toolMap["SQLMap"]} tentativas` : "",
    toolMap["Nikto"]  ? `Nikto detectado: ${toolMap["Nikto"]} tentativas`  : "",
    topCountries.length ? `Top países: ${topCountries.map(([cc, n]) => `${cc}(${n})`).join(", ")}` : "",
  ].filter(Boolean).join(" | ");

  const ddSummary = [
    `Monitores em alerta: ${alertMonitors.length}`,
    activeIncidents.length ? `Incidentes ativos: ${activeIncidents.length}` : "",
    highCpuHosts.length ? `Hosts CPU>85%: ${highCpuHosts.length}` : "",
    podRestartHosts.length ? `Pods reiniciando: ${podRestartHosts.length}` : "",
  ].filter(Boolean).join(" | ");

  const auditSummaryLine = auditSummaries
    .filter(s => s.total > 0)
    .map(s => `${s.service}: ${s.total} eventos, ${s.unmasked} dados reais`)
    .join(" | ") || "sem dados";

  const prompt =
`Você é um analista de segurança cibernética sênior. Com base nos dados coletados do ecossistema Ituran (plataforma integra-prd) nas últimas 24 horas, elabore um relatório executivo em português (máximo 400 palavras).

MÉTRICAS DO PERÍODO:
- Logs Seq: ${seqEvents.length} eventos (${authFails.length} falhas de autenticação)
- Auditoria (Integra, customer360, fieldservice): ${auditTotal} eventos — ${auditSummaryLine}${auditExternalIPs.length > 0 ? ` — ${auditExternalIPs.length} IPs externos` : ""}
- Datadog: ${ddSummary}${breachedSlos.length > 0 ? ` | SLOs em breach: ${breachedSlos.length}` : ""}
- GoCache WAF/Bot/Firewall: ${gcSummary}
- Kubernetes: ${criticalAlerts.length} alertas críticos, ${downDeps.length} deployments parados
- Nível de risco geral: ${overallRisk}

AMEAÇAS CORRELACIONADAS (${findings.length} regras disparadas):
${summaryLines}

Estruture o relatório em 4 seções curtas:
1. **Resumo Executivo** (2-3 frases sobre o estado atual)
2. **Ameaças Prioritárias** (máx 3 bullets com contexto de risco)
3. **Recomendações Imediatas** (máx 3 ações concretas)
4. **Avaliação de Risco** (sentença final com nível e tendência)

Seja direto e objetivo. Evite jargão técnico excessivo.`;

  let narrative = "";
  let narrativeError: string | null = null;
  try {
    narrative = await aiNarrative(prompt);
  } catch (err) {
    const msg = String(err);
    console.error("[report] AI error:", msg);
    narrativeError = msg.startsWith("Error: PROXY_BLOCKED")
      ? "API bloqueada pelo firewall corporativo. Solicite ao TI o desbloqueio."
      : `Análise automática indisponível: ${msg.replace(/^Error: /, "")}`;
    narrative = findings.length > 0
      ? `${narrativeError}\n\nAmeaças identificadas:\n${findings.map(f => `• [${f.risk}] ${f.title}`).join("\n")}`
      : narrativeError;
  }

  return {
    generatedAt: new Date().toISOString(),
    riskLevel:   overallRisk,
    findings,
    narrative,
    ...(narrativeError ? { narrativeError } : {}),
    sources: {
      seq:     { ok: seqOk,  events:  seqEvents.length },
      datadog: { ok: ddOk,   alerts:  alertMonitors.length },
      gocache: { ok: gcOk,   blocked: gcBlockedTotal },
      audit:   { ok: auditTotal > 0, events: auditTotal },
    },
  };
});
