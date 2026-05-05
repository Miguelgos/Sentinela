import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, TrendingUp, Waves, RefreshCw, ChevronDown } from "lucide-react";
import { useAnalysisData } from "@/hooks/useAnalysisData";
import { AnalysisShell } from "@/components/AnalysisShell";
import { StatCard } from "@/components/analysis/StatCard";
import { anomalyApi, queryKeys, type AnomalyEvent, type AnomalyProblem, type AnomalyReport, type AnomalySeverity, type AnomalyTimeline } from "@/lib/api";
import { AreaChart, Area, XAxis, YAxis, ReferenceLine, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/lib/utils";

const SEVERITY_CFG: Record<AnomalySeverity, { label: string; bg: string; text: string; border: string }> = {
  CRITICAL: { label: "CRÍTICO", bg: "bg-red-950",    text: "text-red-300",    border: "border-red-700" },
  HIGH:     { label: "ALTO",    bg: "bg-orange-950", text: "text-orange-300", border: "border-orange-700" },
  MEDIUM:   { label: "MÉDIO",   bg: "bg-yellow-950", text: "text-yellow-300", border: "border-yellow-700" },
};

const DETECTOR_LABEL: Record<string, string> = {
  ERROR_RATE_SERVICE:  "Pico de erros (serviço)",
  ERROR_RATE_ENDPOINT: "Pico de erros (endpoint)",
  AUTH_BURST:          "Burst de auth fail",
  NEW_MESSAGE:         "Mensagem inédita",
  OFF_HOURS:           "Atividade off-hours",
};

function SeverityBadge({ level }: { level: AnomalySeverity }) {
  const cfg = SEVERITY_CFG[level];
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border", cfg.bg, cfg.text, cfg.border)}>
      {cfg.label}
    </span>
  );
}

function AnomalyRow({ anomaly }: { anomaly: AnomalyEvent }) {
  const detectorLabel = DETECTOR_LABEL[anomaly.detector] ?? anomaly.detector;
  return (
    <div className="text-xs space-y-1 py-2 px-3 bg-muted/30 rounded">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{detectorLabel} · <code className="text-muted-foreground">{anomaly.dimension}</code></span>
        <span className="text-muted-foreground">{formatTimestamp(anomaly.detectedAt)}</span>
      </div>
      <ul className="space-y-0.5 ml-1">
        {anomaly.evidence.map((ev, i) => (
          <li key={i} className="font-mono text-muted-foreground">› {ev}</li>
        ))}
      </ul>
    </div>
  );
}

function ProblemCard({ problem }: { problem: AnomalyProblem }) {
  const [open, setOpen] = useState(true);
  const cfg = SEVERITY_CFG[problem.severity];
  const head = problem.anomalies[0];
  const headLabel = DETECTOR_LABEL[head.detector] ?? head.detector;

  return (
    <Card className={cn("border", cfg.border)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">
            {headLabel} <span className="text-muted-foreground font-normal">— {problem.rootDimension}</span>
          </CardTitle>
          <SeverityBadge level={problem.severity} />
        </div>
        <p className="text-xs text-muted-foreground">
          {problem.anomalies.length === 1
            ? "1 anomalia detectada"
            : `${problem.anomalies.length} anomalias correlacionadas`}
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {problem.narrative && (
          <div className="text-sm leading-relaxed bg-muted/40 rounded p-3 border-l-2 border-primary/40">
            {problem.narrative}
          </div>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
          {open ? "Ocultar evidências" : "Ver evidências"}
        </button>
        {open && (
          <div className="space-y-1.5">
            {problem.anomalies.map(a => <AnomalyRow key={`${a.detector}:${a.dimension}:${a.detectedAt}`} anomaly={a} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const timelineChartConfig = {
  metric: { label: "Eventos/min", color: "#a855f7" },
} satisfies ChartConfig;

function TimelineCard({ timeline }: { timeline: AnomalyTimeline }) {
  const detectorLabel = DETECTOR_LABEL[timeline.detector] ?? timeline.detector;
  const data = timeline.points.map(p => ({
    time: new Date(p.minute * 60_000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    metric: p.metric,
  }));
  const maxValue = Math.max(timeline.threshold * 1.1, ...data.map(d => d.metric));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {detectorLabel} · <code className="font-mono">{timeline.dimension}</code>
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Baseline (P99): {timeline.baseline.toFixed(1)} · Threshold: {timeline.threshold.toFixed(1)} · últimos 60 min
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ChartContainer config={timelineChartConfig} className="h-[140px] w-full">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${timeline.dimension}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#a855f7" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
            <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} domain={[0, maxValue]} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area type="monotone" dataKey="metric" stroke="#a855f7" strokeWidth={1.5} fill={`url(#fill-${timeline.dimension})`} />
            <ReferenceLine y={timeline.baseline} stroke="#22c55e" strokeDasharray="4 2" strokeOpacity={0.6}
              label={{ value: "P99", position: "insideRight", fontSize: 9, fill: "#22c55e" }} />
            <ReferenceLine y={timeline.threshold} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.7}
              label={{ value: "Threshold", position: "insideRight", fontSize: 9, fill: "#ef4444" }} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function summarizeByDetector(anomalies: AnomalyEvent[]): Record<string, number> {
  return anomalies.reduce<Record<string, number>>((acc, a) => {
    acc[a.detector] = (acc[a.detector] ?? 0) + 1;
    return acc;
  }, {});
}

function maxSeverity(problems: AnomalyProblem[]): AnomalySeverity | null {
  if (problems.length === 0) return null;
  const order: Record<AnomalySeverity, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1 };
  return problems.reduce<AnomalySeverity>(
    (max, p) => (order[p.severity] > order[max] ? p.severity : max),
    "MEDIUM",
  );
}

export function AnomalyAnalysis() {
  const { data: report, loading, error, reload } = useAnalysisData<AnomalyReport>(
    () => anomalyApi.report(),
    queryKeys.anomalyReport,
  );

  const problems = report?.problems ?? [];
  const anomalies = report?.anomalies ?? [];
  const timelines = report?.timelines ?? [];
  const top = maxSeverity(problems);
  const byDetector = summarizeByDetector(anomalies);

  return (
    <AnalysisShell
      loading={loading}
      error={error}
      onReload={reload}
      skeletonRows={4}
      action={
        <Button variant="outline" size="sm" onClick={reload}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
        </Button>
      }
    >
      {report && (
        <>
          {!report.ready && (
            <Card className="border-yellow-500/30 bg-yellow-500/5">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-yellow-300">Sync inicial em andamento</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Baseline de 7 dias ainda sendo construída. Detectores podem retornar resultados parciais até o sync completar.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {report.narrativeError && (
            <Card className="border-orange-500/30 bg-orange-500/5">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-orange-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-orange-300">Narrativa AI indisponível</p>
                  <p className="text-xs text-muted-foreground mt-1">{report.narrativeError}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-purple-500/30 bg-purple-500/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Activity className="h-5 w-5 text-purple-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-purple-300">
                    Detecção de anomalias estilo Davis (auto-adaptive thresholds)
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Baseline = P99 + IQR sobre 7 dias por minuto. Trigger: 3-de-5 minutos violando o threshold.
                    Multi-dimensional (por serviço) com correlação de problemas. Inspirado no Dynatrace Davis AI.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <StatCard
              icon={<TrendingUp className="h-5 w-5 text-purple-400" />}
              label="Problemas detectados"
              value={problems.length.toLocaleString("pt-BR")}
              tone={problems.length > 0 ? "purple" : "neutral"}
              emphasizeBorder={problems.length > 0}
            />
            <StatCard
              icon={<AlertTriangle className="h-5 w-5 text-red-400" />}
              label="Severidade máxima"
              value={top ? SEVERITY_CFG[top].label : "—"}
              tone={top === "CRITICAL" ? "danger" : top === "HIGH" ? "warning" : "neutral"}
              emphasizeBorder={!!top}
            />
            <StatCard
              icon={<Waves className="h-5 w-5 text-blue-400" />}
              label="Anomalias brutas"
              value={anomalies.length.toLocaleString("pt-BR")}
              tone="info"
              sub={anomalies.length > problems.length ? `${anomalies.length - problems.length} dedup'das` : undefined}
            />
            <StatCard
              icon={<Activity className="h-5 w-5 text-muted-foreground" />}
              label="Eventos analisados"
              value={(report.totalEvents).toLocaleString("pt-BR")}
              sub={report.coverage.oldest ? `desde ${formatTimestamp(report.coverage.oldest)}` : undefined}
            />
          </div>

          {Object.keys(byDetector).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Anomalias por detector</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(byDetector).map(([d, n]) => (
                  <div key={d} className="flex justify-between items-center text-xs px-2 py-1.5 bg-muted/30 rounded">
                    <span className="text-muted-foreground">{DETECTOR_LABEL[d] ?? d}</span>
                    <span className="font-mono font-semibold">{n}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {timelines.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                Timelines (top {timelines.length})
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {timelines.map(t => <TimelineCard key={`${t.detector}:${t.dimension}`} timeline={t} />)}
              </div>
            </div>
          )}

          {problems.length === 0 ? (
            <Card className="border-green-500/30 bg-green-500/5">
              <CardContent className="p-6 text-center">
                <p className="text-sm font-medium text-green-300">Nenhuma anomalia detectada na janela atual</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Métricas dentro do baseline (P99 + IQR × 7 dias). Atualizado em {formatTimestamp(report.generatedAt)}.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                Problemas correlacionados ({problems.length})
              </h2>
              {problems.map(p => <ProblemCard key={p.id} problem={p} />)}
            </div>
          )}
        </>
      )}
    </AnalysisShell>
  );
}
