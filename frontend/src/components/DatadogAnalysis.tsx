import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertTriangle, CheckCircle, Server, Monitor,
  XCircle, HelpCircle, Database, Globe2, Cpu, Layers, RefreshCw,
} from "lucide-react";
import { useAnalysisData } from "@/hooks/useAnalysisData";
import { AnalysisShell } from "@/components/AnalysisShell";
import {
  BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell,
} from "recharts";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { eventsApi, type DatadogOverview, type DatadogMetrics, type DatadogInfra } from "@/lib/api";

const datadogPieChartConfig = {
  value: { label: "Monitores", color: "#3b82f6" },
} satisfies ChartConfig;

const datadogLogChartConfig = {
  error: { label: "Error", color: "#dc2626" },
  warn:  { label: "Warn",  color: "#ca8a04" },
  info:  { label: "Info",  color: "#3b82f6" },
} satisfies ChartConfig;

const datadogCpuChartConfig = {
  cpu: { label: "CPU %", color: "#10b981" },
} satisfies ChartConfig;

const datadogDiskChartConfig = {
  diskPct: { label: "Disco %", color: "#f59e0b" },
} satisfies ChartConfig;

const datadogIisConnectionsChartConfig = {
  connections: { label: "Conexões", color: "#06b6d4" },
} satisfies ChartConfig;

const datadogIisBySiteChartConfig = {
  get:  { label: "GET",  color: "#3b82f6" },
  post: { label: "POST", color: "#8b5cf6" },
} satisfies ChartConfig;

const datadogIisBytesChartConfig = {
  kb: { label: "KB/s", color: "#a855f7" },
} satisfies ChartConfig;

const datadogIisErrorsChartConfig = {
  notFound: { label: "404/s", color: "#ef4444" },
} satisfies ChartConfig;
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    Alert:     "bg-red-500/20 text-red-300 border-red-500/30",
    Warn:      "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    OK:        "bg-green-500/20 text-green-300 border-green-500/30",
    "No Data": "bg-gray-500/20 text-gray-400 border-gray-500/30",
  };
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${map[state] ?? "bg-muted text-muted-foreground"}`}>
      {state}
    </span>
  );
}

function StateIcon({ state }: { state: string }) {
  if (state === "Alert") return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
  if (state === "Warn")  return <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />;
  if (state === "OK")    return <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />;
  return <HelpCircle className="h-4 w-4 text-gray-400 shrink-0" />;
}

function hostAge(ts: number): { label: string; stale: boolean } {
  if (!ts) return { label: "—", stale: true };
  const ageMs = Date.now() - ts * 1000;
  const stale = ageMs > 10 * 60 * 1000; // > 10 min
  const label = formatDistanceToNow(new Date(ts * 1000), { locale: ptBR, addSuffix: true });
  return { label, stale };
}

const PIE_COLORS = ["#3b82f6","#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#6b7280"];

export function DatadogAnalysis() {
  const overviewHook = useAnalysisData(() => eventsApi.datadogOverview());
  const metricsHook  = useAnalysisData(() => eventsApi.datadogMetrics());
  const infraHook    = useAnalysisData(() => eventsApi.datadogInfra());

  const loading = overviewHook.loading || metricsHook.loading || infraHook.loading;
  const error   = overviewHook.error || metricsHook.error || infraHook.error;
  const reload  = () => { overviewHook.reload(); metricsHook.reload(); infraHook.reload(); };

  const data    = overviewHook.data;
  const metrics = metricsHook.data;
  const infra   = infraHook.data;

  return (
    <AnalysisShell
      loading={loading}
      error={error}
      onReload={reload}
      action={
        <Button variant="outline" size="sm" onClick={reload}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
        </Button>
      }
    >
      {data && <DatadogContent data={data} metrics={metrics} infra={infra} />}
    </AnalysisShell>
  );
}

function DatadogContent({
  data,
  metrics,
  infra,
}: {
  data: DatadogOverview;
  metrics: DatadogMetrics | null;
  infra: DatadogInfra | null;
}) {
  const { monitors, logs, hosts } = data;
  const alertCount   = monitors.stateCounts["Alert"]   ?? 0;
  const warnCount    = monitors.stateCounts["Warn"]    ?? 0;
  const okCount      = monitors.stateCounts["OK"]      ?? 0;
  const noDataCount  = monitors.stateCounts["No Data"] ?? 0;

  const logChartData = logs.byService.slice(0, 12).map((s) => ({
    name: s.service.replace(/^(bot-|communication-)/, "").slice(0, 22),
    info: s.info, warn: s.warn, error: s.error,
  }));

  // Services sorted by error rate (only those with at least 1 log)
  const serviceErrorRates = logs.byService
    .filter(s => s.total > 0)
    .map(s => ({ ...s, errorRate: s.total > 0 ? (s.error / s.total) * 100 : 0 }))
    .sort((a, b) => b.errorRate - a.errorRate);

  // Monitor type pie
  const typeData = Object.entries(monitors.byType ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name: name.replace(" alert", ""), value }));

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Monitor className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-blue-300">Datadog — integra-k8s · us5.datadoghq.com</p>
              <p className="text-xs text-muted-foreground mt-1">
                {monitors.total} monitores · {hosts.total} hosts · {logs.total} logs nas últimas 4h
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active incidents */}
      {data.incidents && data.incidents.length > 0 && (
        <Card className="border-red-600/50 bg-red-950/20">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-300">
                {data.incidents.length} Incidente(s) Ativo(s)
              </p>
              {data.incidents.slice(0,3).map((inc, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  #{inc.public_id} — {inc.title}
                  {inc.customer_impact_scope && ` (${inc.customer_impact_scope})`}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monitor state cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className={alertCount > 0 ? "border-red-500/40 ring-1 ring-red-500/30" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <XCircle className="h-6 w-6 text-red-400 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Alert</p>
              <p className="text-2xl font-bold text-red-300">{alertCount}</p></div>
          </CardContent>
        </Card>
        <Card className={warnCount > 0 ? "border-yellow-500/40" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-yellow-400 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Warn</p>
              <p className="text-2xl font-bold text-yellow-300">{warnCount}</p></div>
          </CardContent>
        </Card>
        <Card className="border-green-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-6 w-6 text-green-400 shrink-0" />
            <div><p className="text-xs text-muted-foreground">OK</p>
              <p className="text-2xl font-bold text-green-300">{okCount}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <HelpCircle className="h-6 w-6 text-gray-400 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Sem dados</p>
              <p className="text-2xl font-bold">{noDataCount}</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Downtimes info */}
      {data.downtimes && data.downtimes.length > 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-2 px-1">
          <span className="text-yellow-400">⏸</span>
          <span><strong className="text-foreground">{data.downtimes.filter(d=>d.active).length}</strong> downtime(s) ativo(s) (monitores em manutenção programada)</span>
        </div>
      )}

      {/* SLOs */}
      {data.slos && data.slos.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-400" />
              SLOs — Service Level Objectives
              <Badge variant="secondary" className="ml-auto">{data.slos.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[240px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-muted-foreground">Nome</th>
                    <th className="text-left p-2 text-muted-foreground">Tipo</th>
                    <th className="text-right p-2 text-muted-foreground">Target</th>
                    <th className="text-right p-2 text-muted-foreground">Janela</th>
                  </tr>
                </thead>
                <tbody>
                  {data.slos.map(slo => (
                    <tr key={slo.id} className="border-b hover:bg-muted/20">
                      <td className="p-2 max-w-[240px] truncate" title={slo.name}>{slo.name}</td>
                      <td className="p-2 text-muted-foreground font-mono">{slo.type}</td>
                      <td className="p-2 text-right text-green-300 font-mono">
                        {slo.thresholds[0]?.target_display ?? "—"}%
                      </td>
                      <td className="p-2 text-right text-muted-foreground">
                        {slo.thresholds[0]?.timeframe ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerting monitors */}
      {monitors.alerting.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-400" />
              Monitores em Alerta / Warn
              <Badge variant="error" className="ml-auto">{monitors.alerting.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 text-xs text-muted-foreground">Monitor</th>
                    <th className="text-left p-3 text-xs text-muted-foreground">Tipo</th>
                    <th className="text-left p-3 text-xs text-muted-foreground">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {monitors.alerting.map((m) => (
                    <tr key={m.id} className="border-b hover:bg-muted/20">
                      <td className="p-3 text-xs">
                        <div className="flex items-center gap-2">
                          <StateIcon state={m.state} />
                          <span>{m.name}</span>
                        </div>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground font-mono">{m.type}</td>
                      <td className="p-3"><StateBadge state={m.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* License alerts */}
      {monitors.licenseAlerts.length > 0 && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-orange-300">
              <AlertTriangle className="h-4 w-4" />
              Alertas de Licença Datadog
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {monitors.licenseAlerts.map((m, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{m.name.replace("[license] ", "")}</span>
                  <StateBadge state={m.state} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monitor type breakdown + log volume */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {typeData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Layers className="h-4 w-4 text-purple-400" />
                Tipos de Monitor
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <ChartContainer config={datadogPieChartConfig} className="h-[140px] w-[140px]">
                  <PieChart>
                    <Pie data={typeData} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" paddingAngle={2}>
                      {typeData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </PieChart>
                </ChartContainer>
                <div className="space-y-1 text-xs flex-1">
                  {typeData.map((d, i) => (
                    <div key={d.name} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-muted-foreground truncate max-w-[140px]">{d.name}</span>
                      </div>
                      <Badge variant="secondary">{d.value}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {logChartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-400" />
                Volume de Logs por Serviço — últimas 4h
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={datadogLogChartConfig} className="h-[220px] w-full">
                <BarChart data={logChartData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={115} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="error" stackId="a" fill="#dc2626" name="Error" />
                  <Bar dataKey="warn"  stackId="a" fill="#ca8a04" name="Warn" />
                  <Bar dataKey="info"  stackId="a" fill="#3b82f6" name="Info" />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Service error rate table */}
      {serviceErrorRates.filter(s => s.error > 0).length > 0 && (
        <Card className="border-red-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              Taxa de Erros por Serviço — últimas 4h
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[280px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-muted-foreground">Serviço</th>
                    <th className="text-right p-2 text-muted-foreground">Total</th>
                    <th className="text-right p-2 text-muted-foreground">Erros</th>
                    <th className="text-right p-2 text-muted-foreground">Taxa</th>
                    <th className="p-2 text-muted-foreground w-32">Barra</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceErrorRates.filter(s => s.error > 0).map((s) => (
                    <tr key={s.service} className="border-b hover:bg-muted/20">
                      <td className="p-2 font-mono">{s.service}</td>
                      <td className="p-2 text-right text-muted-foreground">{s.total}</td>
                      <td className="p-2 text-right">
                        <Badge variant="error">{s.error}</Badge>
                      </td>
                      <td className="p-2 text-right font-bold text-red-300">{s.errorRate.toFixed(1)}%</td>
                      <td className="p-2">
                        <div className="h-2 bg-muted rounded-full w-full">
                          <div className="h-2 bg-red-500 rounded-full" style={{ width: `${Math.min(100, s.errorRate)}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hosts + last reported */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Server className="h-4 w-4 text-purple-400" />
            Hosts Ativos
            <Badge variant="secondary" className="ml-auto">{hosts.total}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[280px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 text-muted-foreground">Host</th>
                  <th className="text-left p-2 text-muted-foreground">Apps</th>
                  <th className="text-left p-2 text-muted-foreground">Último reporte</th>
                </tr>
              </thead>
              <tbody>
                {hosts.list.map((h, i) => {
                  const age = hostAge(h.lastReported);
                  return (
                    <tr key={i} className={`border-b hover:bg-muted/20 ${age.stale ? "opacity-60" : ""}`}>
                      <td className="p-2 font-mono text-xs">{h.name}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-0.5">
                          {h.apps.filter((a) => !["agent","ntp"].includes(a)).map((a) => (
                            <span key={a} className="text-xs bg-muted px-1 rounded text-muted-foreground">{a}</span>
                          ))}
                        </div>
                      </td>
                      <td className={`p-2 whitespace-nowrap ${age.stale ? "text-amber-400" : "text-muted-foreground"}`}>
                        {age.label}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Infrastructure — CPU / Memory / Disk / Network / k8s */}
      {infra && (
        <>
          <div className="flex items-center gap-2 pt-2">
            <Cpu className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-emerald-300">Infraestrutura — CPU · Memória · Disco · Rede</h2>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {(() => {
              const cpuMax = infra.cpu.reduce((m, h) => Math.max(m, h.cpu), 0);
              const cpuColor = cpuMax > 80 ? "text-red-300" : cpuMax > 60 ? "text-yellow-300" : "text-green-300";
              const cpuBorder = cpuMax > 80 ? "border-red-500/40 ring-1 ring-red-500/20" : cpuMax > 60 ? "border-yellow-500/30" : "";
              const memAvg = infra.memory.length > 0
                ? infra.memory.reduce((s, h) => s + h.memUsedGb, 0) / infra.memory.length
                : 0;
              const diskMax = infra.disk.reduce((m, h) => Math.max(m, h.diskPct), 0);
              const diskColor = diskMax > 85 ? "text-red-300" : "text-emerald-300";
              const diskBorder = diskMax > 85 ? "border-red-500/40 ring-1 ring-red-500/20" : "";
              const totalRestarts = infra.podRestarts.reduce((s, p) => s + p.restarts, 0);
              const restartColor = totalRestarts > 0 ? "text-orange-300" : "text-muted-foreground";
              const restartBorder = totalRestarts > 0 ? "border-orange-500/30" : "";
              return (
                <>
                  <Card className={cpuBorder}>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">CPU máx</p>
                      <p className={`text-2xl font-bold ${cpuColor}`}>{cpuMax.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">{infra.cpu.length} hosts</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Memória média</p>
                      <p className="text-2xl font-bold text-emerald-300">{memAvg.toFixed(1)}GB</p>
                      <p className="text-xs text-muted-foreground">{infra.memory.length} hosts</p>
                    </CardContent>
                  </Card>
                  <Card className={diskBorder}>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Disco máx</p>
                      <p className={`text-2xl font-bold ${diskColor}`}>{diskMax.toFixed(0)}%</p>
                      <p className="text-xs text-muted-foreground">{infra.disk.length} hosts</p>
                    </CardContent>
                  </Card>
                  <Card className={restartBorder}>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Pod Restarts</p>
                      <p className={`text-2xl font-bold ${restartColor}`}>{totalRestarts}</p>
                      <p className="text-xs text-muted-foreground">{infra.podRestarts.length} deployments</p>
                    </CardContent>
                  </Card>
                </>
              );
            })()}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {infra.cpu.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-emerald-400" />
                    CPU por Host (top 10)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={datadogCpuChartConfig} className="h-[220px] w-full">
                    <BarChart data={[...infra.cpu].sort((a, b) => b.cpu - a.cpu).slice(0, 10)} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 9 }} />
                      <YAxis type="category" dataKey="host" tick={{ fontSize: 9 }} width={130} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="cpu" fill="#10b981" name="CPU %" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}

            {infra.disk.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Server className="h-4 w-4 text-amber-400" />
                    Disco por Host (%)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={datadogDiskChartConfig} className="h-[220px] w-full">
                    <BarChart data={[...infra.disk].sort((a, b) => b.diskPct - a.diskPct)} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 9 }} />
                      <YAxis type="category" dataKey="host" tick={{ fontSize: 9 }} width={130} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="diskPct" name="Disco %" radius={[0, 3, 3, 0]}>
                        {[...infra.disk].sort((a, b) => b.diskPct - a.diskPct).map((d, i) => (
                          <Cell key={i} fill={d.diskPct > 85 ? "#ef4444" : "#f59e0b"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {infra.podRestarts.length > 0 && (
            <Card className="border-orange-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-400" />
                  Pod Restarts por Deployment
                  <Badge variant="secondary" className="ml-auto">{infra.podRestarts.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[240px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0">
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2 text-muted-foreground">Deployment</th>
                        <th className="text-right p-2 text-muted-foreground">Restarts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {infra.podRestarts.map((p) => (
                        <tr key={p.deployment} className="border-b hover:bg-muted/20">
                          <td className="p-2 font-mono">{p.deployment}</td>
                          <td className="p-2 text-right">
                            <Badge variant="error">{p.restarts}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {infra.containerCpu.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-emerald-400" />
                  Container CPU (top 10)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[280px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0">
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2 text-muted-foreground">Container</th>
                        <th className="text-right p-2 text-muted-foreground">CPU %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {infra.containerCpu.slice(0, 10).map((c) => (
                        <tr key={c.container} className="border-b hover:bg-muted/20">
                          <td className="p-2 font-mono" title={c.container}>{c.container.length > 35 ? c.container.slice(0, 35) + "…" : c.container}</td>
                          <td className="p-2 text-right text-emerald-300 font-mono">{c.cpu.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* IIS Metrics */}
      {metrics ? (
        <>
          <div className="flex items-center gap-2 pt-2">
            <Globe2 className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-cyan-300">IIS — Métricas da Última Hora</h2>
          </div>

          {/* IIS summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Conexões ativas</p>
                <p className="text-2xl font-bold text-cyan-300">
                  {metrics.iis.connections.reduce((s, h) => s + h.connections, 0).toLocaleString("pt-BR")}
                </p>
                <p className="text-xs text-muted-foreground">{metrics.iis.connections.length} hosts</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Req/s (GET+POST)</p>
                <p className="text-2xl font-bold text-blue-300">
                  {metrics.iis.bySite.reduce((s, x) => s + x.total, 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                </p>
                <p className="text-xs text-muted-foreground">{metrics.iis.bySite.length} sites</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Bytes transferidos/s</p>
                <p className="text-2xl font-bold text-purple-300">
                  {(metrics.iis.bytes.reduce((s, h) => s + h.bytes, 0) / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Erros 404/s</p>
                <p className="text-2xl font-bold text-red-300">
                  {metrics.iis.errors.reduce((s, h) => s + h.notFound, 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* IIS charts: connections + requests + bytes */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Server className="h-4 w-4 text-cyan-400" />
                  Conexões por Host
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={datadogIisConnectionsChartConfig} className="h-[180px] w-full">
                  <BarChart data={metrics.iis.connections} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 9 }} />
                    <YAxis type="category" dataKey="host" tick={{ fontSize: 9 }} width={130} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="connections" fill="#06b6d4" name="Conexões" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-400" />
                  Requisições por Site (req/s)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={datadogIisBySiteChartConfig} className="h-[180px] w-full">
                  <BarChart data={metrics.iis.bySite.slice(0, 10)} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 9 }} />
                    <YAxis type="category" dataKey="site" tick={{ fontSize: 8 }} width={130} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="get"  stackId="a" fill="#3b82f6" name="GET" />
                    <Bar dataKey="post" stackId="a" fill="#8b5cf6" name="POST" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {metrics.iis.bytes.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Activity className="h-4 w-4 text-purple-400" />
                    Bytes Transferidos por Host (KB/s)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={datadogIisBytesChartConfig} className="h-[180px] w-full">
                    <BarChart data={metrics.iis.bytes.map(h => ({ ...h, kb: +(h.bytes / 1024).toFixed(1) }))} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 9 }} />
                      <YAxis type="category" dataKey="host" tick={{ fontSize: 9 }} width={130} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="kb" fill="#a855f7" name="KB/s" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}

            {metrics.iis.errors.some(h => h.notFound > 0) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-400" />
                    Erros 404 por Host (rate/s)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={datadogIisErrorsChartConfig} className="h-[180px] w-full">
                    <BarChart data={metrics.iis.errors.filter(h => h.notFound > 0)} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 9 }} />
                      <YAxis type="category" dataKey="host" tick={{ fontSize: 9 }} width={130} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="notFound" fill="#ef4444" name="404/s" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* SQL Server section */}
          <div className="flex items-center gap-2 pt-2">
            <Database className="h-4 w-4 text-orange-400" />
            <h2 className="text-sm font-semibold text-orange-300">SQL Server — Última Hora</h2>
          </div>

          {/* SQL summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {metrics.sql.ple.length > 0 && (
              <Card className={metrics.sql.ple.some(h => h.ple < 300) ? "border-red-500/40 ring-1 ring-red-500/20" : "border-green-500/20"}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Cpu className="h-3 w-3" /> PLE (Buffer Pool)
                  </p>
                  {metrics.sql.ple.map(h => (
                    <div key={h.host} className="mt-1">
                      <p className={`text-xl font-bold ${h.ple < 300 ? "text-red-300" : "text-green-300"}`}>
                        {h.ple.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}s
                      </p>
                      <p className="text-xs text-muted-foreground">{h.host} {h.ple < 300 && <span className="text-red-400">⚠ &lt;300</span>}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {metrics.sql.userConnections.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Conexões ativas</p>
                  {metrics.sql.userConnections.map(h => (
                    <div key={h.host} className="mt-1">
                      <p className="text-xl font-bold text-orange-300">{h.connections.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</p>
                      <p className="text-xs text-muted-foreground">{h.host}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {metrics.sql.batchRequests.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Batch Requests/s</p>
                  {metrics.sql.batchRequests.map(h => (
                    <div key={h.host} className="mt-1">
                      <p className="text-xl font-bold text-amber-300">{h.batchPerSec.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</p>
                      <p className="text-xs text-muted-foreground">{h.host}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {metrics.sql.blocked.some(h => h.blocked > 0) && (
              <Card className="border-red-500/30">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Conexões Bloqueadas</p>
                  {metrics.sql.blocked.map(h => (
                    <div key={h.host} className="mt-1">
                      <p className={`text-xl font-bold ${h.blocked > 0 ? "text-red-300" : "text-muted-foreground"}`}>{h.blocked}</p>
                      <p className="text-xs text-muted-foreground">{h.host}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* SQL detail tables */}
          {(metrics.sql.blocked.length > 0 || metrics.sql.fullScans.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-400" />
                    Conexões Bloqueadas
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2 text-muted-foreground">Host</th>
                        <th className="text-right p-2 text-muted-foreground">Bloqueadas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.sql.blocked.map((r) => (
                        <tr key={r.host} className="border-b hover:bg-muted/20">
                          <td className="p-2 font-mono">{r.host}</td>
                          <td className="p-2 text-right">
                            <Badge variant={r.blocked > 0 ? "error" : "secondary"}>{r.blocked}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Database className="h-4 w-4 text-amber-400" />
                    Full Table Scans / s
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2 text-muted-foreground">Host</th>
                        <th className="text-right p-2 text-muted-foreground">Scans/s</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.sql.fullScans.map((r) => (
                        <tr key={r.host} className="border-b hover:bg-muted/20">
                          <td className="p-2 font-mono">{r.host}</td>
                          <td className="p-2 text-right">
                            <span className={r.fullScans > 100 ? "text-amber-300 font-bold" : "text-muted-foreground"}>
                              {r.fullScans.toLocaleString("pt-BR")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
