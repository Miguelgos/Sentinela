import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogIn, ShieldAlert, Globe, User, Wifi, RefreshCw } from "lucide-react";
import { useAnalysisData } from "@/hooks/useAnalysisData";
import { AnalysisShell } from "@/components/AnalysisShell";
import { StatCard } from "@/components/analysis/StatCard";
import { PeriodSelect } from "@/components/analysis/PeriodSelect";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
  ChartLegend, ChartLegendContent, type ChartConfig,
} from "@/components/ui/chart";
import {
  eventsApi,
  type LoginOverview,
  type AuthPeriodHours,
  type LoginSource,
  type LoginFailReason,
} from "@/lib/api";
import { formatTimestamp } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const SOURCE_LABEL: Record<LoginSource, string> = {
  kong:        "Kong (gateway)",
  is_web:      "IS Web (UI)",
  is_api:      "IS Token (API)",
  auth_common: "Auth Common",
};

const SOURCE_COLOR: Record<LoginSource, string> = {
  kong:        "#3b82f6",
  is_web:      "#a855f7",
  is_api:      "#06b6d4",
  auth_common: "#f59e0b",
};

const REASON_LABEL: Record<LoginFailReason, string> = {
  invalid_credentials: "Credenciais inválidas",
  invalid_grant:       "invalid_grant",
  unauthorized:        "Unauthorized (401)",
  server_error:        "Erro de servidor (500)",
  other:               "Outros",
};

const chartConfig = {
  kong:        { label: SOURCE_LABEL.kong,        color: SOURCE_COLOR.kong },
  is_web:      { label: SOURCE_LABEL.is_web,      color: SOURCE_COLOR.is_web },
  is_api:      { label: SOURCE_LABEL.is_api,      color: SOURCE_COLOR.is_api },
  auth_common: { label: SOURCE_LABEL.auth_common, color: SOURCE_COLOR.auth_common },
} satisfies ChartConfig;

function SourceBadge({ source }: { source: LoginSource }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
      style={{ backgroundColor: SOURCE_COLOR[source] + "30", color: SOURCE_COLOR[source] }}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function LoginAnalysis() {
  const [period, setPeriod] = useState<AuthPeriodHours>(24);
  const { data, loading, error, reload } = useAnalysisData<LoginOverview>(
    () => eventsApi.loginOverview(period),
    ["loginOverview", String(period)],
  );

  const summary = data?.summary;
  const timeline = data?.timeline ?? [];
  const topUsers = data?.topUsers ?? [];
  const topIPs = data?.topIPs ?? [];
  const failureReasons = data?.failureReasons ?? [];
  const recentFailures = data?.recentFailures ?? [];

  const chartData = timeline.map((t) => ({
    hora: format(new Date(t.hora), period <= 6 ? "HH:mm" : "dd/MM HH:mm", { locale: ptBR }),
    kong: t.kong,
    is_web: t.is_web,
    is_api: t.is_api,
    auth_common: t.auth_common,
  }));

  return (
    <AnalysisShell
      loading={loading}
      error={error}
      onReload={reload}
      action={
        <div className="flex gap-2 items-center">
          <PeriodSelect value={period} onChange={setPeriod} />
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
          </Button>
        </div>
      }
    >
      {data && (
        <>
          {/* Context banner */}
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <LogIn className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-blue-300">
                    Logins consolidados — Kong + IdentityServer4 + Authentication Common
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Eventos unificados de autenticação de todas as fontes do Seq. IP real só
                    disponível no Kong (gateway). IdentityServer e Authentication Common só
                    correlacionam por <code className="bg-muted px-1 rounded">username</code>.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <StatCard label="Total Logins"     value={(summary?.total ?? 0).toLocaleString("pt-BR")} />
            <StatCard label="Sucesso"          value={(summary?.ok ?? 0).toLocaleString("pt-BR")}    tone="success" />
            <StatCard label="Falha"            value={(summary?.fail ?? 0).toLocaleString("pt-BR")}  tone="danger"  emphasizeBorder />
            <StatCard label="Taxa de Falha"    value={`${summary?.failurePct ?? 0}%`}                tone="warning" emphasizeBorder />
            <StatCard label="IPs Internos"     value={(summary?.internal ?? 0).toLocaleString("pt-BR")} tone="info" />
            <StatCard label="IPs Externos"     value={(summary?.external ?? 0).toLocaleString("pt-BR")} tone="purple" />
          </div>

          {/* Source breakdown cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Kong (gateway)"  value={(summary?.sources.kong ?? 0).toLocaleString("pt-BR")} />
            <StatCard label="IS Web (UI)"     value={(summary?.sources.is_web ?? 0).toLocaleString("pt-BR")} />
            <StatCard label="IS Token (API)"  value={(summary?.sources.is_api ?? 0).toLocaleString("pt-BR")} />
            <StatCard label="Auth Common"     value={(summary?.sources.auth_common ?? 0).toLocaleString("pt-BR")} />
          </div>

          {/* Timeline empilhado por source */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Timeline — Logins por fonte</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[260px] w-full">
                  <AreaChart data={chartData}>
                    <defs>
                      {(["kong", "is_web", "is_api", "auth_common"] as LoginSource[]).map((s) => (
                        <linearGradient key={s} id={`grad-${s}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={SOURCE_COLOR[s]} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={SOURCE_COLOR[s]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="hora" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Area type="monotone" dataKey="kong"        stackId="1" stroke={SOURCE_COLOR.kong}        fill="url(#grad-kong)"        name={SOURCE_LABEL.kong} />
                    <Area type="monotone" dataKey="is_web"      stackId="1" stroke={SOURCE_COLOR.is_web}      fill="url(#grad-is_web)"      name={SOURCE_LABEL.is_web} />
                    <Area type="monotone" dataKey="is_api"      stackId="1" stroke={SOURCE_COLOR.is_api}      fill="url(#grad-is_api)"      name={SOURCE_LABEL.is_api} />
                    <Area type="monotone" dataKey="auth_common" stackId="1" stroke={SOURCE_COLOR.auth_common} fill="url(#grad-auth_common)" name={SOURCE_LABEL.auth_common} />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {/* Failure reasons */}
          {failureReasons.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                  Motivos de Falha
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 text-xs text-muted-foreground">Motivo</th>
                      <th className="text-right p-3 text-xs text-muted-foreground">Ocorrências</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failureReasons.map((r) => (
                      <tr key={r.reason} className="border-b hover:bg-muted/30">
                        <td className="p-3 text-xs">{REASON_LABEL[r.reason]}</td>
                        <td className="p-3 text-xs text-right">
                          <Badge variant="outline">{r.count.toLocaleString("pt-BR")}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Top users + Top IPs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <User className="h-4 w-4 text-orange-400" />
                  Usuários com Mais Falhas
                  <Badge variant="outline" className="ml-auto">{topUsers.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs text-muted-foreground">Username</th>
                        <th className="text-right p-3 text-xs text-muted-foreground">Falhas</th>
                        <th className="text-right p-3 text-xs text-muted-foreground">Sucessos</th>
                        <th className="text-left p-3 text-xs text-muted-foreground">Fontes</th>
                        <th className="text-right p-3 text-xs text-muted-foreground">Último</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topUsers.map((u, i) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="p-3 text-xs font-mono text-amber-300 max-w-[200px] truncate">{u.username}</td>
                          <td className="p-3 text-xs text-right">
                            <Badge variant="error">{u.falhas}</Badge>
                          </td>
                          <td className="p-3 text-xs text-right text-green-400">{u.sucessos}</td>
                          <td className="p-3 text-xs">
                            <div className="flex flex-wrap gap-1">
                              {u.sources.map((s) => <SourceBadge key={s} source={s} />)}
                            </div>
                          </td>
                          <td className="p-3 text-xs text-right text-muted-foreground whitespace-nowrap">
                            {formatTimestamp(u.last_seen)}
                          </td>
                        </tr>
                      ))}
                      {!topUsers.length && <EmptyRow cols={5} />}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Globe className="h-4 w-4 text-blue-400" />
                  IPs com Mais Falhas (Kong)
                  <Badge variant="outline" className="ml-auto">{topIPs.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs text-muted-foreground">IP</th>
                        <th className="text-right p-3 text-xs text-muted-foreground">Falhas</th>
                        <th className="text-right p-3 text-xs text-muted-foreground">Usuários</th>
                        <th className="text-right p-3 text-xs text-muted-foreground">Último</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topIPs.map((ip, i) => (
                        <tr key={i} className={`border-b hover:bg-muted/30 ${ip.usuarios_unicos >= 3 ? "bg-red-500/5" : ""}`}>
                          <td className="p-3 text-xs font-mono">
                            {ip.client_ip}
                            {ip.usuarios_unicos >= 3 && (
                              <ShieldAlert className="inline h-3 w-3 text-red-400 ml-1" />
                            )}
                            {ip.is_internal && (
                              <Wifi className="inline h-3 w-3 text-blue-400 ml-1" />
                            )}
                          </td>
                          <td className="p-3 text-xs text-right">
                            <Badge variant="error">{ip.falhas}</Badge>
                          </td>
                          <td className="p-3 text-xs text-right text-muted-foreground">{ip.usuarios_unicos}</td>
                          <td className="p-3 text-xs text-right text-muted-foreground whitespace-nowrap">
                            {formatTimestamp(ip.last_seen)}
                          </td>
                        </tr>
                      ))}
                      {!topIPs.length && <EmptyRow cols={4} />}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent failures */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Falhas Recentes
                <Badge variant="outline" className="ml-2">{recentFailures.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 text-xs text-muted-foreground">Horário</th>
                      <th className="text-left p-3 text-xs text-muted-foreground">Fonte</th>
                      <th className="text-left p-3 text-xs text-muted-foreground">Username</th>
                      <th className="text-left p-3 text-xs text-muted-foreground">IP</th>
                      <th className="text-left p-3 text-xs text-muted-foreground">ClientId</th>
                      <th className="text-left p-3 text-xs text-muted-foreground">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentFailures.map((r) => (
                      <tr key={r.id} className="border-b hover:bg-muted/30">
                        <td className="p-3 text-xs font-mono whitespace-nowrap text-muted-foreground">{formatTimestamp(r.timestamp)}</td>
                        <td className="p-3"><SourceBadge source={r.source} /></td>
                        <td className="p-3 text-xs font-mono text-amber-300 max-w-[180px] truncate">{r.username || "—"}</td>
                        <td className="p-3 text-xs font-mono text-muted-foreground">{r.client_ip || "—"}</td>
                        <td className="p-3 text-xs text-muted-foreground">{r.client_id || "—"}</td>
                        <td className="p-3 text-xs text-muted-foreground">{r.reason ? REASON_LABEL[r.reason] : "—"}</td>
                      </tr>
                    ))}
                    {!recentFailures.length && <EmptyRow cols={6} />}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </AnalysisShell>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="p-4 text-center text-muted-foreground text-sm">
        Nenhum registro encontrado
      </td>
    </tr>
  );
}
