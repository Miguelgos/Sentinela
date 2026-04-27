import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EventDetail } from "@/components/EventDetail";
import { ShieldAlert, Clock, Users, TrendingUp, User, FileDown, RefreshCw } from "lucide-react";
import { useAnalysisData } from "@/hooks/useAnalysisData";
import { AnalysisShell } from "@/components/AnalysisShell";
import { exportAuthErrorPdf } from "@/lib/exportPdf";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { eventsApi, type AuthErrorStats } from "@/lib/api";
import { formatTimestamp } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const authErrorChartConfig = {
  erros:    { label: "Falhas",          color: "#ef4444" },
  usuarios: { label: "Usuários únicos", color: "#a855f7" },
} satisfies ChartConfig;

function extractEmail(msg: string) {
  return msg.match(/User:\s*(\S+)\s*\|/)?.[1] || "—";
}

function extractClientId(msg: string) {
  return msg.match(/ClientId:\s*(\S+)\s*\|/)?.[1] || "—";
}

function extractStatusCode(msg: string) {
  return msg.match(/StatusCode:\s*(\S+)\s*\|/)?.[1] || "—";
}

export function AuthErrorAnalysis() {
  const { data: stats, loading, error, reload } = useAnalysisData(() => eventsApi.authErrorStats());
  const [selected, setSelected] = useState<AuthErrorStats["recentEvents"][0] | null>(null);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!stats) return;
    setExporting(true);
    try { exportAuthErrorPdf(stats); }
    finally { setExporting(false); }
  }

  const peak = (stats?.timeline || []).reduce(
    (max, t) => parseInt(t.count) > parseInt(max.count || "0") ? t : max,
    { hour: "", count: "0", unique_users: "0" }
  );

  const chartData = (stats?.timeline || []).map((t) => ({
    hora: format(new Date(t.hour), "dd/MM HH:mm", { locale: ptBR }),
    erros: parseInt(t.count),
    usuarios: parseInt(t.unique_users),
  }));

  const uniqueUsers = stats?.topUsers.length || 0;
  const topClient = stats?.topClients[0]?.client_id || "—";

  return (
    <>
      <AnalysisShell
        loading={loading}
        error={error}
        onReload={reload}
        skeletonRows={3}
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reload}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || !stats} className="gap-2">
              <FileDown className="h-4 w-4" />
              {exporting ? "Gerando PDF…" : "Exportar PDF"}
            </Button>
          </div>
        }
      >
        {stats && (
        <>
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-300">
                  Falhas de autenticação — <code className="bg-muted px-1 rounded">/connect/token</code> (ResourceOwner)
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Usuários estão tentando autenticar via fluxo ResourceOwner (senha direta) pelo cliente{" "}
                  <code className="bg-muted px-1 rounded text-amber-400">salesBackoffice</code> e recebendo{" "}
                  <code className="bg-muted px-1 rounded text-red-400">Unauthorized</code>. Possíveis causas:
                  credenciais incorretas, conta bloqueada, senha expirada ou usuário sem permissão no cliente.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            icon={<ShieldAlert className="h-5 w-5 text-red-400" />}
            label="Total de Falhas de Auth"
            value={(stats?.total || 0).toLocaleString("pt-BR")}
            color="border-red-500/30"
          />
          <MetricCard
            icon={<Users className="h-5 w-5 text-purple-400" />}
            label="Usuários com Falha"
            value={uniqueUsers.toLocaleString("pt-BR")}
            color="border-purple-500/30"
          />
          <MetricCard
            icon={<TrendingUp className="h-5 w-5 text-orange-400" />}
            label="Pico de Erros"
            value={peak.count}
            subtitle={peak.hour ? format(new Date(peak.hour), "dd/MM HH:mm") : "—"}
            color="border-orange-500/30"
          />
        </div>

        {chartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-red-400" />
                Timeline de Falhas de Autenticação — por hora
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={authErrorChartConfig} className="h-[200px] w-full">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="authErrGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="hora" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="erros" stroke="#ef4444" fill="url(#authErrGrad)" name="Falhas" />
                  <Area type="monotone" dataKey="usuarios" stroke="#a855f7" fill="transparent" strokeDasharray="4 2" name="Usuários únicos" />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top Users */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <User className="h-4 w-4 text-purple-400" />
                Usuários com Mais Falhas
                <Badge variant="error" className="ml-auto">{stats?.topUsers.length || 0}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 text-xs text-muted-foreground">Email</th>
                      <th className="text-right p-3 text-xs text-muted-foreground">Tentativas</th>
                      <th className="text-right p-3 text-xs text-muted-foreground">Último</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats?.topUsers.map((u, i) => (
                      <tr key={i} className="border-b hover:bg-muted/30">
                        <td className="p-3 text-xs font-mono text-amber-300">{u.email}</td>
                        <td className="p-3 text-xs text-right">
                          <Badge variant="error">{u.count}</Badge>
                        </td>
                        <td className="p-3 text-xs text-right text-muted-foreground whitespace-nowrap">
                          {formatTimestamp(u.last_seen)}
                        </td>
                      </tr>
                    ))}
                    {(!stats?.topUsers.length) && (
                      <tr><td colSpan={3} className="p-4 text-center text-muted-foreground text-sm">Nenhum evento encontrado</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Top Clients */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                Client IDs Envolvidos
                <span className="ml-auto text-xs text-muted-foreground">
                  Principal: <strong className="text-foreground">{topClient}</strong>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 text-xs text-muted-foreground">ClientId</th>
                      <th className="text-right p-3 text-xs text-muted-foreground">Falhas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats?.topClients.map((c, i) => (
                      <tr key={i} className="border-b hover:bg-muted/30">
                        <td className="p-3 text-xs font-mono">{c.client_id}</td>
                        <td className="p-3 text-xs text-right">
                          <Badge variant="error">{c.count}</Badge>
                        </td>
                      </tr>
                    ))}
                    {(!stats?.topClients.length) && (
                      <tr><td colSpan={2} className="p-4 text-center text-muted-foreground text-sm">Nenhum evento encontrado</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent events */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Eventos Recentes — Falhas de Autenticação
              <Badge variant="error" className="ml-2">{stats?.recentEvents.length || 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="rounded-b-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-xs text-muted-foreground">Data/Hora</th>
                    <th className="text-left p-2 text-xs text-muted-foreground">Usuário</th>
                    <th className="text-left p-2 text-xs text-muted-foreground">ClientId</th>
                    <th className="text-left p-2 text-xs text-muted-foreground">Status</th>
                    <th className="text-left p-2 text-xs text-muted-foreground">Trace ID</th>
                  </tr>
                </thead>
                <tbody>
                  {stats?.recentEvents.map((event) => (
                    <tr
                      key={event.id}
                      className="border-b hover:bg-muted/50 cursor-pointer"
                      onClick={() => setSelected(event)}
                    >
                      <td className="p-2 text-xs font-mono whitespace-nowrap">{formatTimestamp(event.timestamp)}</td>
                      <td className="p-2 text-xs font-mono text-amber-300">{extractEmail(event.message || "")}</td>
                      <td className="p-2 text-xs font-mono text-muted-foreground">{extractClientId(event.message || "")}</td>
                      <td className="p-2 text-xs">
                        <Badge variant="error">{extractStatusCode(event.message || "")}</Badge>
                      </td>
                      <td className="p-2 text-xs font-mono text-muted-foreground">
                        {event.trace_id ? event.trace_id.slice(0, 16) + "…" : "—"}
                      </td>
                    </tr>
                  ))}
                  {(!stats?.recentEvents.length) && (
                    <tr><td colSpan={5} className="p-4 text-center text-muted-foreground text-sm">Nenhum evento encontrado</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        </>
        )}
      </AnalysisShell>

      {selected && (
        <EventDetail
          event={selected as unknown as Parameters<typeof EventDetail>[0]["event"]}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function MetricCard({ icon, label, value, subtitle, color }: {
  icon: React.ReactNode; label: string; value: string; subtitle?: string; color?: string;
}) {
  return (
    <Card className={color}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
