import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, XCircle, CheckCircle, Layers } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { eventsApi, type GrafanaKubernetes, type GrafanaPod, type GrafanaAlert } from "@/lib/api";

function podShortName(name: string): string {
  const parts = name.split("-");
  return parts[parts.length - 1] ?? name;
}

function cpuBarColor(cpuPct: number): string {
  if (cpuPct > 80) return "#ef4444";
  if (cpuPct >= 50) return "#eab308";
  return "#22c55e";
}

function SeverityBadge({ severity }: { severity: string }) {
  const lower = severity.toLowerCase();
  const cls =
    lower === "critical"
      ? "bg-red-500/20 text-red-300 border-red-500/30"
      : lower === "warning"
      ? "bg-orange-500/20 text-orange-300 border-orange-500/30"
      : "bg-blue-500/20 text-blue-300 border-blue-500/30";
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${cls}`}>
      {severity}
    </span>
  );
}

export function KubernetesAnalysis() {
  const [data, setData] = useState<GrafanaKubernetes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    eventsApi
      .grafanaKubernetes()
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
          <p className="font-semibold">Erro ao carregar dados do Kubernetes</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { salesbo, deploymentsDown, podRestarts, alerts } = data;

  const replicasOk = salesbo.replicas.available >= salesbo.replicas.desired;
  const hasCritical = alerts.some((a) => a.severity.toLowerCase() === "critical");
  const alertCountColor =
    alerts.length === 0
      ? "text-green-300"
      : hasCritical
      ? "text-red-300"
      : "text-yellow-300";
  const alertCardBorder =
    alerts.length === 0
      ? ""
      : hasCritical
      ? "border-red-500/40 ring-1 ring-red-500/30"
      : "border-yellow-500/30";

  const cpuChartData = salesbo.pods.map((p: GrafanaPod) => ({
    name: podShortName(p.name),
    cpu: parseFloat(p.cpuPct.toFixed(1)),
    fullName: p.name,
  }));

  const chartHeight = Math.max(120, salesbo.pods.length * 28);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-blue-400" />
          <h2 className="text-sm font-semibold text-blue-300">
            Kubernetes — integra-prd
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Atualizar
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className={replicasOk ? "border-green-500/20" : "border-yellow-500/30"}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Réplicas salesbo</p>
            <p
              className={`text-2xl font-bold ${
                replicasOk ? "text-green-300" : "text-yellow-300"
              }`}
            >
              {salesbo.replicas.available}/{salesbo.replicas.desired}
            </p>
            <p className="text-xs text-muted-foreground">disponíveis/desejadas</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">CPU Total salesbo</p>
            <p className="text-2xl font-bold text-blue-300">
              {salesbo.totalCpuPct.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">
              ({salesbo.pods.length} pods)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Memória Total salesbo</p>
            <p className="text-2xl font-bold text-purple-300">
              {salesbo.totalMemGb.toFixed(1)} GB
            </p>
          </CardContent>
        </Card>

        <Card className={alertCardBorder}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Alertas Ativos</p>
            <p className={`text-2xl font-bold ${alertCountColor}`}>
              {alerts.length}
            </p>
            <p className="text-xs text-muted-foreground">
              {alerts.length === 0
                ? "nenhum alerta"
                : hasCritical
                ? "critical detectado"
                : "warnings ativos"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alertas Prometheus */}
      {alerts.length > 0 && (
        <Card className={hasCritical ? "border-red-500/30 bg-red-500/5" : "border-yellow-500/30 bg-yellow-500/5"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle
                className={`h-4 w-4 ${hasCritical ? "text-red-400" : "text-yellow-400"}`}
              />
              Alertas Prometheus
              <Badge variant="secondary" className="ml-auto">
                {alerts.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 text-muted-foreground">Alerta</th>
                    <th className="text-left p-3 text-muted-foreground">Severidade</th>
                    <th className="text-left p-3 text-muted-foreground">Namespace</th>
                    <th className="text-left p-3 text-muted-foreground">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert: GrafanaAlert, i: number) => (
                    <tr key={i} className="border-b hover:bg-muted/20">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle
                            className={`h-3.5 w-3.5 shrink-0 ${
                              alert.severity.toLowerCase() === "critical"
                                ? "text-red-400"
                                : alert.severity.toLowerCase() === "warning"
                                ? "text-orange-400"
                                : "text-blue-400"
                            }`}
                          />
                          <span className="font-mono">{alert.name}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <SeverityBadge severity={alert.severity} />
                      </td>
                      <td className="p-3 text-muted-foreground font-mono">
                        {alert.namespace || "—"}
                      </td>
                      <td className="p-3 text-muted-foreground">{alert.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deployments Parados */}
      {deploymentsDown.length > 0 && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-yellow-300">
                  {deploymentsDown.length} deployment
                  {deploymentsDown.length > 1 ? "s" : ""} com 0 réplicas no integra-prd
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {deploymentsDown.map((dep) => (
                    <span
                      key={dep}
                      className="text-xs bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 px-2 py-0.5 rounded font-mono"
                    >
                      {dep}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* salesbo — Pods */}
      {salesbo.pods.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-400" />
              salesbo — Pods
              <Badge variant="secondary" className="ml-auto">
                {salesbo.pods.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* CPU Bar Chart */}
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={cpuChartData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 9 }} domain={[0, 100]} unit="%" />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 9 }}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(value: number) => [`${value}%`, "CPU"]}
                  labelFormatter={(_label, payload) =>
                    payload?.[0]?.payload?.fullName ?? _label
                  }
                />
                <Bar dataKey="cpu" name="CPU %" radius={[0, 3, 3, 0]}>
                  {cpuChartData.map((entry, i) => (
                    <Cell key={i} fill={cpuBarColor(entry.cpu)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Pod table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-muted-foreground">Pod ID</th>
                    <th className="text-right p-2 text-muted-foreground">CPU%</th>
                    <th className="text-right p-2 text-muted-foreground">Mem MB</th>
                    <th className="text-right p-2 text-muted-foreground">Restarts</th>
                  </tr>
                </thead>
                <tbody>
                  {salesbo.pods.map((pod: GrafanaPod) => (
                    <tr key={pod.name} className="border-b hover:bg-muted/20">
                      <td className="p-2 font-mono text-xs" title={pod.name}>
                        {podShortName(pod.name)}
                      </td>
                      <td
                        className={`p-2 text-right font-mono font-bold ${
                          pod.cpuPct > 80
                            ? "text-red-300"
                            : pod.cpuPct >= 50
                            ? "text-yellow-300"
                            : "text-green-300"
                        }`}
                      >
                        {pod.cpuPct.toFixed(1)}%
                      </td>
                      <td className="p-2 text-right text-muted-foreground font-mono">
                        {pod.memMb.toFixed(0)}
                      </td>
                      <td className="p-2 text-right">
                        {pod.restarts > 0 ? (
                          <Badge variant="error">{pod.restarts}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Restarts no Cluster */}
      {podRestarts.length > 0 && (
        <Card className="border-orange-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-400" />
              Restarts no Cluster
              <Badge variant="secondary" className="ml-auto">
                {Math.min(podRestarts.length, 15)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[320px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-muted-foreground">Pod</th>
                    <th className="text-right p-2 text-muted-foreground">Restarts</th>
                  </tr>
                </thead>
                <tbody>
                  {podRestarts.slice(0, 15).map((p) => {
                    const isSeq = p.pod.includes("seq-0");
                    return (
                      <tr
                        key={p.pod}
                        className={`border-b hover:bg-muted/20 ${
                          isSeq ? "bg-yellow-500/10" : ""
                        }`}
                      >
                        <td
                          className={`p-2 font-mono ${
                            isSeq ? "text-yellow-300 font-semibold" : ""
                          }`}
                          title={isSeq ? "Servidor Seq — restarts afetam coleta de dados" : undefined}
                        >
                          {p.pod}
                          {isSeq && (
                            <span className="ml-2 text-yellow-400/80">(Seq)</span>
                          )}
                        </td>
                        <td className="p-2 text-right">
                          <Badge variant={isSeq ? "error" : "secondary"}>
                            {p.restarts}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
