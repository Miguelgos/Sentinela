import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, XCircle, Activity, Cpu } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { eventsApi, type GrafanaJobScheduler, type GrafanaProvider } from "@/lib/api";

function errorRateColor(rate: number): string {
  if (rate > 10) return "text-red-400";
  if (rate >= 1) return "text-yellow-400";
  return "text-green-400";
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

export function JobSchedulerAnalysis() {
  const [data, setData] = useState<GrafanaJobScheduler | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    eventsApi
      .grafanaJobScheduler()
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="p-6 text-center text-red-400">
          <XCircle className="h-8 w-8 mx-auto mb-2" />
          <p className="font-semibold">Erro ao carregar dados do JobScheduler</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { providers, totals } = data;

  const activeProviders = providers.filter((p: GrafanaProvider) => p.activeRequests > 0).length;
  const providersWithErrorsLastHour = providers
    .filter((p: GrafanaProvider) => p.errorsLastHour > 0)
    .sort((a, b) => b.errorsLastHour - a.errorsLastHour);

  const top15ByProcessed = [...providers]
    .sort((a, b) => b.processed - a.processed)
    .slice(0, 15);

  const chartData = top15ByProcessed.map((p: GrafanaProvider) => ({
    name: truncate(p.name, 28),
    fullName: p.name,
    processed: p.processed,
    errors: p.errors,
  }));

  const chartHeight = Math.max(180, top15ByProcessed.length * 28);

  const allSorted = [...providers].sort((a, b) => b.processed - a.processed);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-blue-400" />
          <h2 className="text-sm font-semibold text-blue-300">
            JobScheduler — Execução de Jobs
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Atualizar
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Processado</p>
            <p className="text-2xl font-bold text-blue-300">
              {totals.processed.toLocaleString("pt-BR")}
            </p>
            <p className="text-xs text-muted-foreground">{providers.length} providers</p>
          </CardContent>
        </Card>

        <Card className={totals.errors > 0 ? "border-red-500/40 ring-1 ring-red-500/20" : ""}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Erros</p>
            <p
              className={`text-2xl font-bold ${
                totals.errors > 0 ? "text-red-300" : "text-muted-foreground"
              }`}
            >
              {totals.errors.toLocaleString("pt-BR")}
            </p>
          </CardContent>
        </Card>

        <Card
          className={
            totals.errorRate > 10
              ? "border-red-500/40 ring-1 ring-red-500/20"
              : totals.errorRate >= 1
              ? "border-yellow-500/30"
              : "border-green-500/20"
          }
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Taxa de Erro</p>
            <p className={`text-2xl font-bold ${errorRateColor(totals.errorRate)}`}>
              {totals.errorRate.toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Providers Ativos</p>
            <p className="text-2xl font-bold text-emerald-300">{activeProviders}</p>
            <p className="text-xs text-muted-foreground">com requests ativos</p>
          </CardContent>
        </Card>
      </div>

      {/* Erros na Última Hora */}
      {providersWithErrorsLastHour.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              Erros na Última Hora
              <Badge variant="error" className="ml-auto">
                {providersWithErrorsLastHour.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[280px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-muted-foreground">Provider</th>
                    <th className="text-right p-2 text-muted-foreground">
                      Erros na última hora
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {providersWithErrorsLastHour.map((p: GrafanaProvider) => (
                    <tr key={p.name} className="border-b hover:bg-muted/20">
                      <td
                        className={`p-2 font-mono ${
                          p.errorsLastHour > 10000 ? "text-red-300 font-bold" : ""
                        }`}
                        title={p.name}
                      >
                        {truncate(p.name, 50)}
                      </td>
                      <td className="p-2 text-right">
                        <span
                          className={`font-bold ${
                            p.errorsLastHour > 10000
                              ? "text-red-300"
                              : "text-orange-300"
                          }`}
                        >
                          {p.errorsLastHour.toLocaleString("pt-BR")} erros na última hora
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Volume por Provider — Top 15 */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-400" />
              Volume por Provider (Top 15)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={chartData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 9 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 8 }}
                  width={200}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  labelFormatter={(_label, payload) =>
                    payload?.[0]?.payload?.fullName ?? _label
                  }
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="processed" fill="#3b82f6" name="Processados" radius={[0, 3, 3, 0]} />
                <Bar dataKey="errors" fill="#ef4444" name="Erros" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Tabela Detalhada */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Cpu className="h-4 w-4 text-purple-400" />
            Tabela Detalhada
            <Badge variant="secondary" className="ml-auto">
              {allSorted.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 text-muted-foreground">Provider</th>
                  <th className="text-right p-2 text-muted-foreground">Processados</th>
                  <th className="text-right p-2 text-muted-foreground">Erros</th>
                  <th className="text-right p-2 text-muted-foreground">Taxa Erro</th>
                  <th className="text-right p-2 text-muted-foreground">Duração Média</th>
                  <th className="text-right p-2 text-muted-foreground">Ativos</th>
                </tr>
              </thead>
              <tbody>
                {allSorted.map((p: GrafanaProvider) => (
                  <tr key={p.name} className="border-b hover:bg-muted/20">
                    <td className="p-2 font-mono" title={p.name}>
                      {truncate(p.name, 40)}
                    </td>
                    <td className="p-2 text-right text-blue-300 font-mono">
                      {p.processed.toLocaleString("pt-BR")}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {p.errors > 0 ? (
                        <span className="text-red-300">{p.errors.toLocaleString("pt-BR")}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className={`p-2 text-right font-mono font-bold ${errorRateColor(p.errorRate)}`}>
                      {p.errorRate.toFixed(1)}%
                    </td>
                    <td className="p-2 text-right text-muted-foreground font-mono">
                      {formatDuration(p.avgDurationMs)}
                    </td>
                    <td className="p-2 text-right">
                      {p.activeRequests > 0 ? (
                        <Badge variant="secondary">{p.activeRequests}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
