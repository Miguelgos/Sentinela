import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, AlertTriangle, CheckCircle, Server, Monitor,
  XCircle, HelpCircle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { eventsApi, type DatadogOverview } from "@/lib/api";

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    Alert: "bg-red-500/20 text-red-300 border-red-500/30",
    Warn:  "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    OK:    "bg-green-500/20 text-green-300 border-green-500/30",
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

export function DatadogAnalysis() {
  const [data, setData] = useState<DatadogOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    eventsApi.datadogOverview()
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-32 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="p-6 text-center text-red-400">
          <XCircle className="h-8 w-8 mx-auto mb-2" />
          <p className="font-semibold">Erro ao conectar com Datadog</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const { monitors, logs, hosts } = data;
  const alertCount = monitors.stateCounts["Alert"] ?? 0;
  const warnCount  = monitors.stateCounts["Warn"]  ?? 0;
  const okCount    = monitors.stateCounts["OK"]    ?? 0;
  const noDataCount = monitors.stateCounts["No Data"] ?? 0;

  const chartData = logs.byService.slice(0, 12).map((s) => ({
    name: s.service.replace(/^(bot-|communication-)/, "").slice(0, 20),
    info: s.info,
    warn: s.warn,
    error: s.error,
  }));

  return (
    <div className="space-y-6">
      {/* Context banner */}
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

      {/* Monitor state summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className={alertCount > 0 ? "border-red-500/40 ring-1 ring-red-500/30" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <XCircle className="h-6 w-6 text-red-400 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Alert</p>
              <p className="text-2xl font-bold text-red-300">{alertCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className={warnCount > 0 ? "border-yellow-500/40" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-yellow-400 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Warn</p>
              <p className="text-2xl font-bold text-yellow-300">{warnCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-6 w-6 text-green-400 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">OK</p>
              <p className="text-2xl font-bold text-green-300">{okCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <HelpCircle className="h-6 w-6 text-gray-400 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Sem dados</p>
              <p className="text-2xl font-bold">{noDataCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

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
                      <td className="p-3 text-xs flex items-center gap-2">
                        <StateIcon state={m.state} />
                        {m.name}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground font-mono">{m.type}</td>
                      <td className="p-3 text-xs"><StateBadge state={m.state} /></td>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Log volume by service */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-400" />
                Volume de Logs por Serviço — últimas 4h
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={110} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  />
                  <Bar dataKey="error" stackId="a" fill="#dc2626" name="Error" />
                  <Bar dataKey="warn"  stackId="a" fill="#ca8a04" name="Warn" />
                  <Bar dataKey="info"  stackId="a" fill="#3b82f6" name="Info" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Hosts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4 text-purple-400" />
              Hosts Ativos
              <Badge variant="secondary" className="ml-auto">{hosts.total}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[220px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-muted-foreground">Host</th>
                    <th className="text-left p-2 text-muted-foreground">Apps</th>
                  </tr>
                </thead>
                <tbody>
                  {hosts.list.map((h, i) => (
                    <tr key={i} className="border-b hover:bg-muted/20">
                      <td className="p-2 font-mono text-xs">{h.name}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-0.5">
                          {h.apps.filter((a) => !["agent","ntp"].includes(a)).map((a) => (
                            <span key={a} className="text-xs bg-muted px-1 rounded text-muted-foreground">{a}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* All monitors table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            Todos os Monitores
            <Badge variant="secondary" className="ml-auto">{monitors.total}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 text-muted-foreground">Monitor</th>
                  <th className="text-left p-2 text-muted-foreground">Estado</th>
                </tr>
              </thead>
              <tbody>
                  {monitors.alerting.map((m) => (
                  <tr key={m.id} className="border-b hover:bg-muted/20">
                    <td className="p-2 flex items-center gap-2"><StateIcon state={m.state} />{m.name}</td>
                    <td className="p-2"><StateBadge state={m.state} /></td>
                  </tr>
                ))}
                {Object.entries(monitors.stateCounts).map(([state, count]) => (
                  <tr key={state} className="border-b bg-muted/10">
                    <td className="p-2 text-muted-foreground italic pl-4">{count} monitor(es) com estado: {state}</td>
                    <td className="p-2"><StateBadge state={state} /></td>
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
