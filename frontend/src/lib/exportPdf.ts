import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { KongAuthStats, StatsSummary, TimelineEntry, AuthErrorStats, SecurityStats } from "./api";

// ── Palette ────────────────────────────────────────────────────────────────
const BRAND  = "#1d4ed8";
const RED    = "#dc2626";
const ORANGE = "#ea580c";
const YELLOW = "#ca8a04";
const GREEN  = "#16a34a";
const GRAY   = "#6b7280";
const LIGHT  = "#f3f4f6";

type LastTable = jsPDF & { lastAutoTable: { finalY: number } };

// ── Shared helpers ─────────────────────────────────────────────────────────
function ts(iso: string | null | undefined) {
  if (!iso) return "—";
  return format(new Date(iso), "dd/MM/yyyy HH:mm:ss", { locale: ptBR });
}

function now() {
  return format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR });
}

function stamp() {
  return format(new Date(), "yyyy-MM-dd_HH-mm");
}

function header(doc: jsPDF, title: string, subtitle = "Ituran · integra-prd · salesbo") {
  const n = now();
  doc.setFillColor(BRAND);
  doc.rect(0, 0, 210, 28, "F");
  doc.setFontSize(16);
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, 12);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(subtitle, 14, 18);
  doc.text(`Gerado em ${n}  ·  Dados: últimas 4-6h`, 14, 23);
  doc.setTextColor("#000000");
  return { startY: 35, now: n };
}

function footers(doc: jsPDF, label: string, n: string) {
  const pageCount = (doc.internal as { getNumberOfPages: () => number }).getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(GRAY);
    doc.setFont("helvetica", "normal");
    doc.text(`Ituran · Seq Analyzer · ${label} · ${n}`, 14, 291);
    doc.text(`Página ${i} / ${pageCount}`, 196, 291, { align: "right" });
  }
}

function section(doc: jsPDF, y: number, title: string, color = BRAND): number {
  doc.setFillColor(color);
  doc.rect(14, y, 182, 6, "F");
  doc.setFontSize(9);
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.text(title.toUpperCase(), 17, y + 4.2);
  doc.setTextColor("#000000");
  doc.setFont("helvetica", "normal");
  return y + 10;
}

function checkPage(doc: jsPDF, y: number, needed = 30): number {
  if (y + needed > 278) { doc.addPage(); return 15; }
  return y;
}

function table(doc: jsPDF, y: number, head: string[][], body: (string | number)[][], opts?: { color?: string; fontSize?: number }) {
  autoTable(doc, {
    startY: y,
    head,
    body,
    styles: { fontSize: opts?.fontSize ?? 7.5, cellPadding: 2 },
    headStyles: { fillColor: opts?.color ?? BRAND, textColor: "#fff", fontStyle: "bold" },
    margin: { left: 14, right: 14 },
  });
  return (doc as LastTable).lastAutoTable.finalY + 6;
}

function summaryBox(doc: jsPDF, y: number, cols: [string, string, string?][]) {
  const colW = 182 / 3;
  doc.setFillColor(LIGHT);
  doc.rect(14, y, 182, Math.ceil(cols.length / 3) * 11 + 5, "F");
  doc.setDrawColor("#d1d5db");
  doc.rect(14, y, 182, Math.ceil(cols.length / 3) * 11 + 5, "S");
  cols.forEach(([label, val, color], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 14 + col * colW + 4;
    const ry = y + row * 11 + 4;
    doc.setFontSize(7);
    doc.setTextColor(GRAY);
    doc.setFont("helvetica", "normal");
    doc.text(label, x, ry);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(color ?? "#111827");
    doc.text(val, x, ry + 5.5);
  });
  doc.setTextColor("#000000");
  return y + Math.ceil(cols.length / 3) * 11 + 10;
}

// ── Kong Auth ──────────────────────────────────────────────────────────────
export function exportKongAuthPdf(stats: KongAuthStats) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const { startY, now: n } = header(doc, "Kong Auth Request — Análise de Falhas");
  const { summary, timeline, topUsers, topIPs, credentialStuffing, serverErrors, recentFailures } = stats;

  let y = summaryBox(doc, startY, [
    ["Total Requests",   summary.total.toLocaleString("pt-BR")],
    ["Falhas (!= 200)",  summary.failures.toLocaleString("pt-BR"), RED],
    ["Taxa de Falha",    `${summary.failurePct}%`, ORANGE],
    ["401 Unauthorized", summary.failures401.toLocaleString("pt-BR"), ORANGE],
    ["500 Server Error", summary.failures500.toLocaleString("pt-BR"), RED],
    ["Sucesso (200)",    summary.successes.toLocaleString("pt-BR"), GREEN],
  ]);

  if (credentialStuffing.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, `[!] Credential Stuffing / Enumeracao de Usernames — ${credentialStuffing.length} IP(s)`, RED);
    y = table(doc, y, [["IP", "Usuários tentados", "Falhas", "Janela (min)", "Início", "Fim"]],
      credentialStuffing.map((r) => [r.client_ip, r.usuarios_tentados, r.total_falhas, r.janela_min, ts(r.first_seen), ts(r.last_seen)]),
      { color: RED });
  }

  if (timeline.length > 0) {
    y = checkPage(doc, y, 35);
    y = section(doc, y, "Timeline — Kong Auth por hora");
    y = table(doc, y, [["Hora", "Falhas", "Sucessos", "Total", "Taxa Falha"]],
      timeline.map((t) => {
        const tot = t.falhas + t.sucessos;
        return [format(new Date(t.hora), "dd/MM HH:mm", { locale: ptBR }), t.falhas, t.sucessos, tot,
          tot > 0 ? `${((t.falhas / tot) * 100).toFixed(1)}%` : "—"];
      }));
  }

  if (topUsers.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, `Usuários com Mais Falhas (top ${topUsers.length})`);
    y = table(doc, y, [["Username", "Falhas", "Primeiro", "Último"]],
      topUsers.map((u) => [u.username, u.falhas, ts(u.first_seen), ts(u.last_seen)]));
  }

  if (topIPs.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, `IPs com Mais Falhas (top ${topIPs.length})`);
    y = table(doc, y, [["IP", "Falhas", "Usuários únicos", "Primeiro", "Último"]],
      topIPs.map((ip) => [ip.client_ip, ip.falhas, ip.usuarios_unicos, ts(ip.first_seen), ts(ip.last_seen)]));
  }

  if (serverErrors.length > 0) {
    y = checkPage(doc, y, 35);
    y = section(doc, y, `Erros 500 — Falha Interna no Kong (${serverErrors.length})`, RED);
    y = table(doc, y, [["Horário", "Username", "IP", "Path"]],
      serverErrors.map((r) => [ts(r.timestamp), r.username || "—", r.client_ip || "—", r.path || "—"]),
      { color: RED });
  }

  if (recentFailures.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, `Falhas Recentes (últimas ${recentFailures.length})`);
    table(doc, y, [["Horário", "Status", "Username", "IP", "Path", "Module"]],
      recentFailures.map((r) => [ts(r.timestamp), r.status_code, r.username || "—", r.client_ip || "—", r.path || "—", r.module || "—"]),
      { fontSize: 7 });
  }

  footers(doc, "Kong Auth Analysis", n);
  doc.save(`kong-auth-${stamp()}.pdf`);
}

// ── Dashboard ──────────────────────────────────────────────────────────────
export function exportDashboardPdf(
  stats: StatsSummary,
  timeline: TimelineEntry[],
  names: Record<string, string>,
  authStats: AuthErrorStats | null,
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const { startY, now: n } = header(doc, "Dashboard — Resumo de Eventos");

  const emptyGuid = parseInt(stats.guidBreakdown?.empty_guid || "0");
  const validGuid = parseInt(stats.guidBreakdown?.valid_guid || "0");
  const total = emptyGuid + validGuid;
  const emptyPct = total > 0 ? ((emptyGuid / total) * 100).toFixed(1) : "0";

  let y = summaryBox(doc, startY, [
    ["Total de Eventos",  stats.total.toLocaleString("pt-BR")],
    ["Erros",            stats.errors.toLocaleString("pt-BR"), RED],
    ["Falhas de Auth",   (authStats?.total ?? 0).toLocaleString("pt-BR"), ORANGE],
    ["GUID vazio",       emptyGuid.toLocaleString("pt-BR"), ORANGE],
    ["GUID valido",      validGuid.toLocaleString("pt-BR"), GREEN],
    ["Taxa GUID vazio",  `${emptyPct}%`, emptyPct > "10" ? RED : ORANGE],
  ]);

  // By level
  y = checkPage(doc, y, 35);
  y = section(doc, y, "Distribuição por Nível");
  y = table(doc, y, [["Nível", "Eventos"]],
    stats.byLevel.map((l) => [l.level, parseInt(l.count).toLocaleString("pt-BR")]));

  // Timeline
  if (timeline.length > 0) {
    const timeMap: Record<string, Record<string, number>> = {};
    for (const e of timeline) {
      const h = format(new Date(e.hour), "dd/MM HH:mm", { locale: ptBR });
      if (!timeMap[h]) timeMap[h] = {};
      timeMap[h][e.level] = parseInt(e.count);
    }
    const levels = [...new Set(timeline.map((t) => t.level))];
    y = checkPage(doc, y, 40);
    y = section(doc, y, "Timeline — Últimas 24h (por hora)");
    y = table(doc, y, [["Hora", ...levels]],
      Object.entries(timeMap).map(([h, lv]) => [h, ...levels.map((l) => lv[l] ?? 0)]));
  }

  // Top errors
  if (stats.topErrors.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, "Top Erros por Mensagem", RED);
    y = table(doc, y, [["Mensagem", "Ocorrências"]],
      stats.topErrors.map((e) => [e.message || "—", parseInt(e.count).toLocaleString("pt-BR")]),
      { color: RED });
  }

  // Top users
  if (stats.topUsers.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, "Usuários com Mais Eventos");
    y = table(doc, y, [["User ID", "Nome", "Eventos"]],
      stats.topUsers.map((u) => [u.user_id, names[u.user_id] || "—", parseInt(u.count).toLocaleString("pt-BR")]));
  }

  // Top services
  if (stats.topServices?.length > 0) {
    y = checkPage(doc, y, 35);
    y = section(doc, y, "Top Serviços");
    y = table(doc, y, [["Serviço", "Eventos"]],
      stats.topServices.map((s) => [s.service, parseInt(s.count).toLocaleString("pt-BR")]));
  }

  // Auth errors top users
  if (authStats && authStats.topUsers.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, "Top Usuários com Falha de Autenticação", ORANGE);
    table(doc, y, [["Email", "Falhas", "Último"]],
      authStats.topUsers.map((u) => [u.email, u.count, ts(u.last_seen)]),
      { color: ORANGE });
  }

  footers(doc, "Dashboard", n);
  doc.save(`dashboard-${stamp()}.pdf`);
}

// ── GUID vazio ─────────────────────────────────────────────────────────────
export function exportErrorAnalysisPdf(
  events: { total: number; data: { id: number; timestamp: string; user_id: string | null; level: string; message: string | null; request_path: string | null }[] },
  timeline: { hour: string; count: string; unique_users: string }[],
  names: Record<string, string>,
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const { startY, now: n } = header(doc, "Análise — GUID Cotação Vazio");

  const uniqueUsers = new Set(events.data.map((e) => e.user_id).filter(Boolean)).size;
  const peak = timeline.reduce((m, t) => parseInt(t.count) > parseInt(m.count) ? t : m,
    { hour: "", count: "0", unique_users: "0" });

  let y = summaryBox(doc, startY, [
    ["Total de Erros",    events.total.toLocaleString("pt-BR"), RED],
    ["Usuários afetados", uniqueUsers.toLocaleString("pt-BR"), ORANGE],
    ["Pico (hora)",       `${peak.count} erros`, ORANGE],
  ]);

  // Context note
  doc.setFontSize(8);
  doc.setTextColor(GRAY);
  doc.setFont("helvetica", "italic");
  doc.text(
    "Endpoint Quote/PrintItens chamado com GUID_COTACAO zerado — frontend dispara impressão antes de obter cotação válida.",
    14, y, { maxWidth: 182 }
  );
  doc.setFont("helvetica", "normal");
  doc.setTextColor("#000000");
  y += 12;

  // Timeline
  if (timeline.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, "Timeline — Erros por Hora");
    y = table(doc, y, [["Hora", "Erros", "Usuários únicos"]],
      timeline.map((t) => [format(new Date(t.hour), "dd/MM HH:mm", { locale: ptBR }), t.count, t.unique_users]));
  }

  // Events
  if (events.data.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, `Eventos com GUID Vazio (últimos ${events.data.length})`, ORANGE);
    table(doc, y, [["Horário", "Nível", "User ID", "Nome", "Path"]],
      events.data.map((e) => [
        ts(e.timestamp),
        e.level,
        e.user_id || "—",
        names[e.user_id ?? ""] || "—",
        e.request_path || "—",
      ]),
      { fontSize: 7, color: ORANGE });
  }

  footers(doc, "GUID Cotação Vazio", n);
  doc.save(`guid-vazio-${stamp()}.pdf`);
}

// ── Auth Errors ────────────────────────────────────────────────────────────
export function exportAuthErrorPdf(stats: AuthErrorStats) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const { startY, now: n } = header(doc, "Falhas de Autenticação — /connect/token");

  const peak = stats.timeline.reduce((m, t) => parseInt(t.count) > parseInt(m.count) ? t : m,
    { hour: "", count: "0", unique_users: "0" });

  let y = summaryBox(doc, startY, [
    ["Total de Falhas",   stats.total.toLocaleString("pt-BR"), RED],
    ["Usuários afetados", stats.topUsers.length.toLocaleString("pt-BR"), ORANGE],
    ["Pico (hora)",       `${peak.count} erros`, ORANGE],
    ["Principal Client",  stats.topClients[0]?.client_id || "—"],
  ]);

  // Timeline
  if (stats.timeline.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, "Timeline — Falhas por Hora", RED);
    y = table(doc, y, [["Hora", "Falhas", "Usuários únicos"]],
      stats.timeline.map((t) => [format(new Date(t.hour), "dd/MM HH:mm", { locale: ptBR }), t.count, t.unique_users]),
      { color: RED });
  }

  // Top users
  if (stats.topUsers.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, `Usuários com Mais Falhas (${stats.topUsers.length})`);
    y = table(doc, y, [["Email", "Falhas", "Último"]],
      stats.topUsers.map((u) => [u.email, u.count, ts(u.last_seen)]));
  }

  // Top clients
  if (stats.topClients.length > 0) {
    y = checkPage(doc, y, 35);
    y = section(doc, y, "Client IDs Envolvidos");
    y = table(doc, y, [["Client ID", "Falhas"]],
      stats.topClients.map((c) => [c.client_id, c.count]));
  }

  // Recent events
  if (stats.recentEvents.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, `Eventos Recentes (${stats.recentEvents.length})`, RED);
    table(doc, y, [["Horário", "Nível", "Trace ID", "Path"]],
      stats.recentEvents.map((e) => [
        ts(e.timestamp),
        e.level,
        e.trace_id ? e.trace_id.slice(0, 16) + "…" : "—",
        e.request_path || "—",
      ]),
      { fontSize: 7, color: RED });
  }

  footers(doc, "Falhas de Autenticação", n);
  doc.save(`auth-errors-${stamp()}.pdf`);
}

// ── Security ───────────────────────────────────────────────────────────────
export function exportSecurityPdf(stats: SecurityStats) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const { startY, now: n } = header(doc, "Análise de Segurança — salesbo");

  const findings = [
    { id: "SEC-010", sev: "CRITICO",  title: "JWT / Token em logs",           detail: `${stats.jwtInLogs.total} ocorrências, ${stats.jwtInLogs.uniqueTokens} token(s) único(s)`, action: "Remover log TokenRecebido em produção" },
    { id: "SEC-011", sev: "CRITICO",  title: "Certificado SSL expirado",       detail: stats.expiredCerts.map((c) => `${c.cert_name || "auth-dev.ituran.dev"} (exp. ${c.expired_on}): ${c.count} avisos`).join("; ") || "—", action: "Renovar certificado imediatamente" },
    { id: "SEC-001", sev: "CRITICO",  title: "Brute Force detectado",          detail: `${stats.bruteForce.length} usuário(s) com >= 3 tentativas em < 5 min`, action: "Implementar rate-limit e bloqueio de conta" },
    { id: "SEC-002", sev: "CRITICO",  title: "Exceções críticas não tratadas", detail: `${stats.criticalByContext.length} contextos com erros Critical`, action: "Tratar exceções e adicionar fallback" },
    { id: "SEC-012", sev: "ALTO",     title: "DataProtection sem criptografia",detail: `${stats.dataProtectionUnencrypted} chaves sem XML encryptor`, action: "Configurar encryptor (Azure Key Vault / DPAPI)" },
    { id: "SEC-013", sev: "ALTO",     title: "ForwardedHeaders mismatch",      detail: `${stats.forwardedHeadersMismatch.toLocaleString("pt-BR")} avisos — risco de IP spoofing`, action: "Corrigir configuração de proxy reverso" },
    { id: "SEC-003", sev: "ALTO",     title: "Swagger em produção",            detail: `${stats.swaggerEvidence} ocorrências detectadas`, action: "Desabilitar Swagger em ambiente de produção" },
    { id: "SEC-004", sev: "ALTO",     title: "Stack traces expostos",          detail: `${stats.stackTraceEndpoints.length} endpoint(s) com stack trace nos logs`, action: "Usar handler global de exceções sem expor stack" },
    { id: "SEC-014", sev: "ALTO",     title: "EF Core client-side eval",       detail: `${stats.efClientEval.localEval} eval local + ${stats.efClientEval.noOrderBy} First() sem OrderBy`, action: "Reescrever queries para tradução SQL completa" },
    { id: "SEC-015", sev: "MEDIO",    title: "Hangfire job failures",          detail: `${stats.hangfireFailures.length} jobs com falha/retry`, action: "Investigar dead queue e implementar alertas" },
    { id: "SEC-005", sev: "MEDIO",    title: "Usernames anômalos",             detail: `${stats.anomalousUsernames.length} username(s) em formato não-email`, action: "Validar formato de username no login" },
    { id: "SEC-006", sev: "MEDIO",    title: "Usuários com 100% GUID vazio",   detail: `${stats.onlyEmptyGuidUsers.length} usuário(s) nunca enviaram GUID válido`, action: "Investigar integração do cliente" },
    { id: "SEC-016", sev: "MEDIO",    title: "IPs de veículos (PocSag) em log",detail: `${stats.vehicleIpsExposed.toLocaleString("pt-BR")} IPs únicos — risco LGPD`, action: "Remover ou mascarar IPs de dispositivos nos logs" },
    { id: "SEC-017", sev: "MEDIO",    title: "Queries lentas (> 500ms)",       detail: `${stats.slowQueries.count} queries, máximo ${stats.slowQueries.maxMs}ms`, action: "Adicionar índices e revisar N+1 queries" },
  ];

  const sevColor: Record<string, string> = { CRITICO: RED, ALTO: ORANGE, MEDIO: YELLOW };
  const counts: Record<string, number> = { CRITICO: 0, ALTO: 0, MEDIO: 0 };
  findings.forEach((f) => { counts[f.sev] = (counts[f.sev] ?? 0) + 1; });

  let y = summaryBox(doc, startY, [
    ["Achados CRITICO", counts["CRITICO"].toString(), RED],
    ["Achados ALTO",    counts["ALTO"].toString(),    ORANGE],
    ["Achados MEDIO",   counts["MEDIO"].toString(),   YELLOW],
  ]);

  // All findings table
  y = checkPage(doc, y, 40);
  y = section(doc, y, "Sumário de Achados de Segurança");
  autoTable(doc, {
    startY: y,
    head: [["ID", "Severidade", "Achado", "Detalhe", "Ação Recomendada"]],
    body: findings.map((f) => [f.id, f.sev, f.title, f.detail, f.action]),
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: BRAND, textColor: "#fff", fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 18 },
      2: { cellWidth: 38 },
      3: { cellWidth: 60 },
      4: { cellWidth: 48 },
    },
    didParseCell: (data) => {
      if (data.column.index === 1 && data.section === "body") {
        const sev = data.cell.text[0] as string;
        data.cell.styles.textColor = sevColor[sev] ?? GRAY;
        data.cell.styles.fontStyle = "bold";
      }
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as LastTable).lastAutoTable.finalY + 6;

  // Brute force detail
  if (stats.bruteForce.length > 0) {
    y = checkPage(doc, y, 40);
    y = section(doc, y, "SEC-001 — Brute Force: detalhe por usuário", RED);
    y = table(doc, y, [["Username", "Tentativas", "Req/min", "Janela (min)", "Início", "Fim"]],
      stats.bruteForce.map((r) => [r.username, r.attempts, r.rate_per_min, r.window_minutes, ts(r.first_seen), ts(r.last_seen)]),
      { color: RED, fontSize: 7 });
  }

  // Hangfire detail
  if (stats.hangfireFailures.length > 0) {
    y = checkPage(doc, y, 35);
    y = section(doc, y, "SEC-015 — Hangfire: jobs com falha", YELLOW);
    y = table(doc, y, [["Mensagem", "Ocorrências", "Último"]],
      stats.hangfireFailures.map((r) => [r.message, r.count, ts(r.last_seen)]),
      { color: YELLOW, fontSize: 7 });
  }

  // Stack trace endpoints
  if (stats.stackTraceEndpoints.length > 0) {
    y = checkPage(doc, y, 35);
    y = section(doc, y, "SEC-004 — Endpoints com Stack Trace", ORANGE);
    table(doc, y, [["Endpoint", "Ocorrências"]],
      stats.stackTraceEndpoints.map((r) => [r.request_path, r.count]),
      { color: ORANGE, fontSize: 7 });
  }

  footers(doc, "Análise de Segurança", n);
  doc.save(`security-${stamp()}.pdf`);
}
