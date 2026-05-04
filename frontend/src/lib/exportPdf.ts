import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { KongAuthStats, StatsSummary, TimelineEntry, AuthErrorStats, ThreatReport, RiskLevel } from "./api";

// ── Logo preload (rasterize SVG → PNG data URL on first import) ────────────
let _logoDataUrl: string | null = null;

fetch("/sentinela_v1_radar_pulso.svg")
  .then((r) => r.text())
  .then((svgText) => {
    const blob    = new Blob([svgText], { type: "image/svg+xml" });
    const blobUrl = URL.createObjectURL(blob);
    const img     = new Image();
    img.onload = () => {
      const canvas  = document.createElement("canvas");
      canvas.width  = 800;
      canvas.height = 320;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, 800, 320);
        _logoDataUrl = canvas.toDataURL("image/png");
      }
      URL.revokeObjectURL(blobUrl);
    };
    img.src = blobUrl;
  })
  .catch(() => {});

// ── Palette ────────────────────────────────────────────────────────────────
const BRAND  = "#1d4ed8";
const RED    = "#dc2626";
const ORANGE = "#ea580c";
const YELLOW = "#ca8a04";
const GREEN  = "#16a34a";
const GRAY   = "#6b7280";
const LIGHT  = "#f3f4f6";

type LastTable = jsPDF & { lastAutoTable: { finalY: number } };

// ── Format helpers ─────────────────────────────────────────────────────────
const nfmt = (x: string | number) => (typeof x === "string" ? parseInt(x) : x).toLocaleString("pt-BR");
const ts = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }) : "—";
const hfmt = (iso: string) => format(new Date(iso), "dd/MM HH:mm", { locale: ptBR });
const stamp = () => format(new Date(), "yyyy-MM-dd_HH-mm");

// ── Logo ───────────────────────────────────────────────────────────────────
function drawLogo(doc: jsPDF, cx: number, cy: number) {
  const hw = 6.5;

  doc.setFillColor(BRAND);
  doc.setDrawColor(BRAND);
  doc.setLineWidth(0);
  doc.lines(
    [[hw, 1.4], [0, 7.7], [-2.5, 5.5], [-4, 3.0], [-4, -3.0], [-2.5, -5.5], [0, -7.7]],
    cx, cy - 8.6, [1, 1], "F", true,
  );

  doc.setDrawColor("#93c5fd");
  doc.setLineWidth(0.25);
  doc.lines(
    [[5.2, 1.1], [0, 6.4], [-2.1, 4.7], [-3.1, 2.5], [-3.1, -2.5], [-2.1, -4.7], [0, -6.4]],
    cx, cy - 7.2, [1, 1], "S", true,
  );

  const dl = doc as unknown as { lines: (lines: number[][], x: number, y: number, scale: [number, number], style: string) => void };
  doc.setLineWidth(0.28);
  doc.setDrawColor("#93c5fd");
  dl.lines([[2.1, -3.2, 6.3, -3.2, 8.4, 0]], cx - 4.2, cy - 0.6, [1, 1], "S");
  dl.lines([[2.1,  3.2, 6.3,  3.2, 8.4, 0]], cx - 4.2, cy + 0.6, [1, 1], "S");

  doc.setDrawColor("#bfdbfe");
  doc.setLineWidth(0.4);
  doc.ellipse(cx, cy, 4.2, 2.5, "S");
  doc.setFillColor("#1e3a8a");
  doc.circle(cx, cy, 1.7, "F");
  doc.setFillColor("#0f172a");
  doc.circle(cx, cy, 0.95, "F");
  doc.setFillColor("#93c5fd");
  doc.circle(cx + 0.65, cy - 0.65, 0.42, "F");

  const dash = doc as unknown as { setLineDashPattern: (a: number[], p: number) => void };
  doc.setDrawColor("#60a5fa");
  doc.setLineWidth(0.2);
  dash.setLineDashPattern([0.7, 1.4], 0);
  doc.line(cx - hw, cy, cx + hw, cy);
  dash.setLineDashPattern([], 0);
  doc.setLineWidth(0.2);
  doc.setDrawColor("#000000");
}

// ── Layout primitives ──────────────────────────────────────────────────────
function header(doc: jsPDF, title: string, subtitle = "Ituran · integra-prd") {
  const n = format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR });
  doc.setFillColor(BRAND);
  doc.rect(0, 0, 210, 28, "F");
  if (_logoDataUrl) doc.addImage(_logoDataUrl, "PNG", 148, 3, 55, 22);
  else drawLogo(doc, 196, 14);

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
  const pageCount = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(GRAY);
    doc.setFont("helvetica", "normal");
    doc.text(`Ituran · Sentinela · ${label} · ${n}`, 14, 291);
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
  return y + needed > 278 ? (doc.addPage(), 15) : y;
}

type TableOpts = {
  color?: string;
  fontSize?: number;
  columnStyles?: Record<number, object>;
  didParseCell?: (data: Parameters<NonNullable<Parameters<typeof autoTable>[1]["didParseCell"]>>[0]) => void;
};

function table(doc: jsPDF, y: number, head: string[][], body: (string | number)[][], opts?: TableOpts) {
  autoTable(doc, {
    startY: y,
    head,
    body,
    styles: { fontSize: opts?.fontSize ?? 7.5, cellPadding: 2 },
    headStyles: { fillColor: opts?.color ?? BRAND, textColor: "#fff", fontStyle: "bold" },
    ...(opts?.columnStyles ? { columnStyles: opts.columnStyles } : {}),
    ...(opts?.didParseCell ? { didParseCell: opts.didParseCell } : {}),
    margin: { left: 14, right: 14 },
  });
  return (doc as LastTable).lastAutoTable.finalY + 6;
}

// Composto de checkPage + section + table — wrapper do trio repetido
// dezenas de vezes. needPage default cobre "header da seção + 1ª página da
// tabela"; aumente quando o conteúdo exigir folga maior.
function tableSection(
  doc: jsPDF, y: number, title: string,
  head: string[][], body: (string | number)[][],
  opts?: TableOpts & { needPage?: number },
): number {
  y = checkPage(doc, y, opts?.needPage ?? 35);
  y = section(doc, y, title, opts?.color);
  return table(doc, y, head, body, opts);
}

function summaryBox(doc: jsPDF, y: number, cols: [string, string, string?][]) {
  const colW = 182 / 3;
  const rows = Math.ceil(cols.length / 3);
  const h = rows * 11 + 5;
  doc.setFillColor(LIGHT);
  doc.rect(14, y, 182, h, "F");
  doc.setDrawColor("#d1d5db");
  doc.rect(14, y, 182, h, "S");
  cols.forEach(([label, val, color], i) => {
    const x = 14 + (i % 3) * colW + 4;
    const ry = y + Math.floor(i / 3) * 11 + 4;
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
  return y + h + 5;
}

// Boilerplate de criar doc + header + footers + save em uma chamada.
function withDocument(
  title: string, label: string, filenamePrefix: string,
  build: (doc: jsPDF, startY: number) => void,
  subtitle?: string,
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const { startY, now: n } = header(doc, title, subtitle);
  build(doc, startY);
  footers(doc, label, n);
  doc.save(`${filenamePrefix}-${stamp()}.pdf`);
}

// ── Kong Auth ──────────────────────────────────────────────────────────────
export function exportKongAuthPdf(stats: KongAuthStats) {
  withDocument("Kong Auth Request — Análise de Falhas", "Kong Auth Analysis", "kong-auth", (doc, startY) => {
    const { summary, timeline, topUsers, topIPs, credentialStuffing, serverErrors, recentFailures } = stats;

    let y = summaryBox(doc, startY, [
      ["Total Requests",   nfmt(summary.total)],
      ["Falhas (!= 200)",  nfmt(summary.failures), RED],
      ["Taxa de Falha",    `${summary.failurePct}%`, ORANGE],
      ["401 Unauthorized", nfmt(summary.failures401), ORANGE],
      ["500 Server Error", nfmt(summary.failures500), RED],
      ["Sucesso (200)",    nfmt(summary.successes), GREEN],
    ]);

    if (credentialStuffing.length > 0) {
      y = tableSection(doc, y,
        `[!] Credential Stuffing / Enumeracao de Usernames — ${credentialStuffing.length} IP(s)`,
        [["IP", "Usuários tentados", "Falhas", "Janela (min)", "Início", "Fim"]],
        credentialStuffing.map(r => [r.client_ip, r.usuarios_tentados, r.total_falhas, r.janela_min, ts(r.first_seen), ts(r.last_seen)]),
        { color: RED, needPage: 40 });
    }

    if (timeline.length > 0) {
      y = tableSection(doc, y, "Timeline — Kong Auth por hora",
        [["Hora", "Falhas", "Sucessos", "Total", "Taxa Falha"]],
        timeline.map(t => {
          const tot = t.falhas + t.sucessos;
          return [hfmt(t.hora), t.falhas, t.sucessos, tot, tot > 0 ? `${((t.falhas / tot) * 100).toFixed(1)}%` : "—"];
        }));
    }

    if (topUsers.length > 0) {
      y = tableSection(doc, y, `Usuários com Mais Falhas (top ${topUsers.length})`,
        [["Username", "Falhas", "Primeiro", "Último"]],
        topUsers.map(u => [u.username, u.falhas, ts(u.first_seen), ts(u.last_seen)]),
        { needPage: 40 });
    }

    if (topIPs.length > 0) {
      y = tableSection(doc, y, `IPs com Mais Falhas (top ${topIPs.length})`,
        [["IP", "Falhas", "Usuários únicos", "Primeiro", "Último"]],
        topIPs.map(ip => [ip.client_ip, ip.falhas, ip.usuarios_unicos, ts(ip.first_seen), ts(ip.last_seen)]),
        { needPage: 40 });
    }

    if (serverErrors.length > 0) {
      y = tableSection(doc, y, `Erros 500 — Falha Interna no Kong (${serverErrors.length})`,
        [["Horário", "Username", "IP", "Path"]],
        serverErrors.map(r => [ts(r.timestamp), r.username || "—", r.client_ip || "—", r.path || "—"]),
        { color: RED });
    }

    if (recentFailures.length > 0) {
      tableSection(doc, y, `Falhas Recentes (últimas ${recentFailures.length})`,
        [["Horário", "Status", "Username", "IP", "Path", "Module"]],
        recentFailures.map(r => [ts(r.timestamp), r.status_code, r.username || "—", r.client_ip || "—", r.path || "—", r.module || "—"]),
        { fontSize: 7, needPage: 40 });
    }
  });
}

// ── Dashboard ──────────────────────────────────────────────────────────────
export function exportDashboardPdf(
  stats: StatsSummary, timeline: TimelineEntry[],
  names: Record<string, string>, authStats: AuthErrorStats | null,
) {
  withDocument("Dashboard — Resumo de Eventos", "Dashboard", "dashboard", (doc, startY) => {
    let y = summaryBox(doc, startY, [
      ["Total de Eventos", nfmt(stats.total)],
      ["Erros",            nfmt(stats.errors), RED],
      ["Falhas de Auth",   nfmt(authStats?.total ?? 0), ORANGE],
    ]);

    y = tableSection(doc, y, "Distribuição por Nível",
      [["Nível", "Eventos"]],
      stats.byLevel.map(l => [l.level, nfmt(l.count)]));

    if (timeline.length > 0) {
      const timeMap: Record<string, Record<string, number>> = {};
      for (const e of timeline) {
        const h = hfmt(e.hour);
        (timeMap[h] ??= {})[e.level] = parseInt(e.count);
      }
      const levels = [...new Set(timeline.map(t => t.level))];
      y = tableSection(doc, y, "Timeline — Últimas 24h (por hora)",
        [["Hora", ...levels]],
        Object.entries(timeMap).map(([h, lv]) => [h, ...levels.map(l => lv[l] ?? 0)]),
        { needPage: 40 });
    }

    if (stats.topErrors.length > 0) {
      y = tableSection(doc, y, "Top Erros por Mensagem",
        [["Mensagem", "Ocorrências"]],
        stats.topErrors.map(e => [e.message || "—", nfmt(e.count)]),
        { color: RED, needPage: 40 });
    }

    if (stats.topUsers.length > 0) {
      y = tableSection(doc, y, "Usuários com Mais Eventos",
        [["User ID", "Nome", "Eventos"]],
        stats.topUsers.map(u => [u.user_id, names[u.user_id] || "—", nfmt(u.count)]),
        { needPage: 40 });
    }

    if (stats.topServices?.length > 0) {
      y = tableSection(doc, y, "Top Serviços",
        [["Serviço", "Eventos"]],
        stats.topServices.map(s => [s.service, nfmt(s.count)]));
    }

    if (authStats && authStats.topUsers.length > 0) {
      tableSection(doc, y, "Top Usuários com Falha de Autenticação",
        [["Email", "Falhas", "Último"]],
        authStats.topUsers.map(u => [u.email, u.count, ts(u.last_seen)]),
        { color: ORANGE, needPage: 40 });
    }
  });
}

// ── Auth Errors ────────────────────────────────────────────────────────────
export function exportAuthErrorPdf(stats: AuthErrorStats) {
  withDocument("Falhas de Autenticação — /connect/token", "Falhas de Autenticação", "auth-errors", (doc, startY) => {
    const peak = stats.timeline.reduce(
      (m, t) => parseInt(t.count) > parseInt(m.count) ? t : m,
      { hour: "", count: "0", unique_users: "0" },
    );

    let y = summaryBox(doc, startY, [
      ["Total de Falhas",   nfmt(stats.total), RED],
      ["Usuários afetados", nfmt(stats.topUsers.length), ORANGE],
      ["Pico (hora)",       `${peak.count} erros`, ORANGE],
      ["Principal Client",  stats.topClients[0]?.client_id || "—"],
    ]);

    if (stats.timeline.length > 0) {
      y = tableSection(doc, y, "Timeline — Falhas por Hora",
        [["Hora", "Falhas", "Usuários únicos"]],
        stats.timeline.map(t => [hfmt(t.hour), t.count, t.unique_users]),
        { color: RED, needPage: 40 });
    }

    if (stats.topUsers.length > 0) {
      y = tableSection(doc, y, `Usuários com Mais Falhas (${stats.topUsers.length})`,
        [["Email", "Falhas", "Último"]],
        stats.topUsers.map(u => [u.email, u.count, ts(u.last_seen)]),
        { needPage: 40 });
    }

    if (stats.topClients.length > 0) {
      y = tableSection(doc, y, "Client IDs Envolvidos",
        [["Client ID", "Falhas"]],
        stats.topClients.map(c => [c.client_id, c.count]));
    }

    if (stats.recentEvents.length > 0) {
      tableSection(doc, y, `Eventos Recentes (${stats.recentEvents.length})`,
        [["Horário", "Nível", "Trace ID", "Path"]],
        stats.recentEvents.map(e => [
          ts(e.timestamp), e.level,
          e.trace_id ? e.trace_id.slice(0, 16) + "…" : "—",
          e.request_path || "—",
        ]),
        { fontSize: 7, color: RED, needPage: 40 });
    }
  });
}

// ── Threat Report ──────────────────────────────────────────────────────────
const RISK_LABEL: Record<RiskLevel, string> = {
  CRITICAL: "CRÍTICO", HIGH: "ALTO", MEDIUM: "MÉDIO", LOW: "BAIXO", INFO: "INFO",
};
const RISK_COLOR: Record<RiskLevel, string> = {
  CRITICAL: RED, HIGH: ORANGE, MEDIUM: YELLOW, LOW: GREEN, INFO: BRAND,
};

export function exportThreatReportPdf(report: ThreatReport) {
  withDocument(
    "Relatório de Ameaças Cibernéticas",
    "Relatório de Ameaças",
    "relatorio-ameacas",
    (doc, startY) => {
      const rLvl = report.riskLevel;

      let y = summaryBox(doc, startY, [
        ["Risco Geral",         RISK_LABEL[rLvl],                                          RISK_COLOR[rLvl]],
        ["Ameaças Detectadas",  String(report.findings.length),                            report.findings.length > 0 ? ORANGE : GREEN],
        ["Seq — Eventos",       nfmt(report.sources.seq.events),                            report.sources.seq.ok ? GREEN : RED],
        ["Datadog — Alertas",   String(report.sources.datadog.alerts),                      report.sources.datadog.ok ? (report.sources.datadog.alerts > 0 ? ORANGE : GREEN) : RED],
        ["GoCache — Bloqueios", nfmt(report.sources.gocache.blocked),                       report.sources.gocache.ok ? (report.sources.gocache.blocked > 0 ? ORANGE : GREEN) : RED],
        ["Gerado em",           hfmt(report.generatedAt)],
      ]);

      y = tableSection(doc, y, "Fontes de Dados",
        [["Fonte", "Status", "Período", "Métrica"]],
        [
          ["Seq (Logs de Aplicação)", report.sources.seq.ok     ? "OK" : "ERRO", "Acumulado",   `${nfmt(report.sources.seq.events)} eventos`],
          ["Datadog (Monitores)",     report.sources.datadog.ok ? "OK" : "ERRO", "Tempo real",  `${report.sources.datadog.alerts} monitor(es) em alerta`],
          ["GoCache WAF",             report.sources.gocache.ok ? "OK" : "ERRO", "Últimas 24h", `${nfmt(report.sources.gocache.blocked)} eventos bloqueados`],
        ],
        {
          fontSize: 8,
          columnStyles: { 1: { cellWidth: 22 } },
          didParseCell: (data) => {
            if (data.column.index === 1 && data.section === "body") {
              data.cell.styles.textColor = data.cell.text[0] === "OK" ? GREEN : RED;
              data.cell.styles.fontStyle = "bold";
            }
          },
        });

      y = checkPage(doc, y, 40);
      y = section(doc, y, `Ameaças Detectadas — ${report.findings.length} achado(s)`, RISK_COLOR[rLvl]);

      if (report.findings.length === 0) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(GREEN);
        doc.text("Nenhuma ameaça crítica identificada nas últimas 24 horas.", 14, y);
        doc.setTextColor("#000");
        y += 8;
      } else {
        y = table(doc, y,
          [["Risco", "Regra", "Título", "Descrição"]],
          report.findings.map(f => [RISK_LABEL[f.risk], f.rule, f.title, f.description]),
          {
            columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 38 }, 2: { cellWidth: 50 }, 3: { cellWidth: 76 } },
            didParseCell: (data) => {
              if (data.column.index === 0 && data.section === "body") {
                const lbl = data.cell.text[0];
                const col = (Object.entries(RISK_LABEL).find(([, v]) => v === lbl)?.[0]) as RiskLevel | undefined;
                data.cell.styles.textColor = col ? RISK_COLOR[col] : GRAY;
                data.cell.styles.fontStyle = "bold";
              }
            },
          });

        for (const f of report.findings) {
          if (f.evidence.length === 0) continue;
          const fColor = RISK_COLOR[f.risk];
          y = tableSection(doc, y, `${RISK_LABEL[f.risk]} · ${f.title}`,
            [["Evidências"]],
            f.evidence.map(ev => [ev]),
            { color: fColor });
          y -= 2;
        }
      }

      y = checkPage(doc, y, 40);
      y = section(doc, y, "Análise IA");

      for (const line of report.narrative.split("\n").filter(l => l.trim() !== "")) {
        const trimmed   = line.trim();
        const isHeading = /^\*\*[^*]+\*\*/.test(trimmed) || /^#{1,3}\s/.test(trimmed);
        const isBullet  = /^[•\-*] /.test(trimmed) && !isHeading;
        const cleaned   = trimmed
          .replace(/^\*\*(.+)\*\*$/, "$1")
          .replace(/^#{1,3}\s/, "")
          .replace(/\*\*(.+?)\*\*/g, "$1")
          .trim();

        if (isHeading) {
          y = checkPage(doc, y, 12);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9.5);
          doc.setTextColor(BRAND);
          doc.text(cleaned, 14, y);
          y += 6;
        } else if (isBullet || cleaned) {
          const body    = isBullet ? `- ${cleaned.replace(/^[•\-*]\s*/, "")}` : cleaned;
          const wrapped = doc.splitTextToSize(body, isBullet ? 174 : 182);
          y = checkPage(doc, y, wrapped.length * 4.5 + 2);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.5);
          doc.setTextColor("#374151");
          doc.text(wrapped, isBullet ? 18 : 14, y);
          y += wrapped.length * 4.5 + 1;
        }
      }

      y += 4;
      y = checkPage(doc, y, 10);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      doc.setTextColor(GRAY);
      doc.text(
        "Esta analise foi gerada automaticamente por IA e deve ser revisada por um analista de seguranca.",
        14, y, { maxWidth: 182 },
      );
    },
    "Ituran · integra-prd · Análise Automatizada",
  );
}
