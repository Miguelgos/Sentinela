import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ShieldAlert, Globe, Server, User, Wifi, FileDown,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
  ChartLegend, ChartLegendContent, type ChartConfig,
} from "@/components/ui/chart";
import { eventsApi, type KongAuthStats } from "@/lib/api";

const kongChartConfig = {
  sucessos: { label: "Sucesso (200)", color: "#22c55e" },
  falhas:   { label: "Falha (≠200)",  color: "#ef4444" },
} satisfies ChartConfig;
import { exportKongAuthPdf } from "@/lib/exportPdf";
import { formatTimestamp } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function isInternal(ip: string) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

function StatusBadge({ code }: { code: number }) {
  if (code === 500) return <Badge className="bg-red-700 text-white text-[10px]">500</Badge>;
  if (code === 401) return <Badge className="bg-orange-600 text-white text-[10px]">401</Badge>;
  return <Badge variant="outline" className="text-[10px]">{code}</Badge>;
}

export function KongAuthAnalysis() {
  const [stats, setStats] = useState<KongAuthStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    eventsApi.kongAuthStats().then(setStats).finally(() => setLoading(false));
  }, []);

  async function handleExport() {
    if (!stats) return;
    setExporting(true);
    try {
      exportKongAuthPdf(stats);
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-32 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (!stats) return <p className="text-muted-foreground">Erro ao carregar dados.</p>;

  const { summary, timeline, topUsers, topIPs, credentialStuffing, serverErrors, recentFailures } = stats;

  const chartData = timeline.map((t) => ({
    hora: format(new Date(t.hora), "HH:mm", { locale: ptBR }),
    falhas: t.falhas,
    sucessos: t.sucessos,
  }));

  const internalIpFailures = recentFailures.filter((r) => isInternal(r.client_ip || ""));

  return (
    <div className="space-y-6">
      {/* Header row with export button */}
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting || !stats}
          className="gap-2"
        >
          <FileDown className="h-4 w-4" />
          {exporting ? "Gerando PDF…" : "Exportar PDF"}
        </Button>
      </div>

      {/* Context banner */}
      <Card className="border-orange-500/30 bg-orange-500/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Globe className="h-5 w-5 text-orange-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-orange-300">
                Kong Gateway — Requests de autenticação com falha
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Eventos <code className="bg-muted px-1 rounded">Kong Auth Request</code> com{" "}
                <code className="bg-muted px-1 rounded text-red-400">StatusCode ≠ 200</code>.
                Inclui tentativas de login na área do cliente via Kong API Gateway.
                Dados dos últimos 6h de retenção.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <MetricCard label="Total Requests" value={summary.total.toLocaleString("pt-BR")} color="border-muted" />
        <MetricCard label="Falhas" value={summary.failures.toLocaleString("pt-BR")} color="border-red-500/40" valueColor="text-red-400" />
        <MetricCard label="Taxa de Falha" value={`${summary.failurePct}%`} color="border-orange-500/40" valueColor="text-orange-400" />
        <MetricCard label="401 Unauthorized" value={summary.failures401.toLocaleString("pt-BR")} color="border-orange-500/30" />
        <MetricCard label="500 Server Error" value={summary.failures500.toLocaleString("pt-BR")} color="border-red-700/40" valueColor="text-red-500" />
      </div>

      {/* Alerts */}
      {credentialStuffing.length > 0 && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-300">
              <ShieldAlert className="h-4 w-4" />
              Credential Stuffing / Username Enumeration detectado
              <Badge className="bg-red-700 text-white ml-auto">{credentialStuffing.length} IPs</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 text-xs text-muted-foreground">IP</th>
                  <th className="text-right p-3 text-xs text-muted-foreground">Usuários tentados</th>
                  <th className="text-right p-3 text-xs text-muted-foreground">Falhas</th>
                  <th className="text-right p-3 text-xs text-muted-foreground">Janela</th>
                  <th className="text-right p-3 text-xs text-muted-foreground">Início</th>
                  <th className="text-right p-3 text-xs text-muted-foreground">Fim</th>
                </tr>
              </thead>
              <tbody>
                {credentialStuffing.map((r, i) => (
                  <tr key={i} className="border-b hover:bg-muted/30">
                    <td className="p-3 text-xs font-mono text-red-300">{r.client_ip}</td>
                    <td className="p-3 text-xs text-right">
                      <Badge className="bg-red-700 text-white">{r.usuarios_tentados}</Badge>
                    </td>
                    <td className="p-3 text-xs text-right">{r.total_falhas}</td>
                    <td className="p-3 text-xs text-right text-muted-foreground">{r.janela_min} min</td>
                    <td className="p-3 text-xs text-right text-muted-foreground whitespace-nowrap">{formatTimestamp(r.first_seen)}</td>
                    <td className="p-3 text-xs text-right text-muted-foreground whitespace-nowrap">{formatTimestamp(r.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {internalIpFailures.length > 0 && (
        <Card className="border-blue-500/40 bg-blue-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Wifi className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-300">
              <strong>{internalIpFailures.length} falhas de IPs internos</strong> (10.x / 192.168.x) — usuários ou sistemas internos com credenciais incorretas.
              {internalIpFailures.slice(0, 3).map((r) => (
                <span key={r.id} className="block font-mono mt-1 text-muted-foreground">
                  {r.client_ip} → {r.username} ({r.status_code})
                </span>
              ))}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Timeline — Kong Auth por hora</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={kongChartConfig} className="h-[200px] w-full">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="kongFail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="kongOk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hora" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area type="monotone" dataKey="sucessos" stroke="#22c55e" fill="url(#kongOk)" name="Sucesso (200)" />
                <Area type="monotone" dataKey="falhas" stroke="#ef4444" fill="url(#kongFail)" name="Falha (≠200)" />
              </AreaChart>
            </ChartContainer>
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
                      <td className="p-3 text-xs text-right text-muted-foreground whitespace-nowrap">
                        {formatTimestamp(u.last_seen)}
                      </td>
                    </tr>
                  ))}
                  {!topUsers.length && <EmptyRow cols={3} />}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-400" />
              IPs com Mais Falhas
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
                    <tr key={i} className={`border-b hover:bg-muted/30 ${parseInt(ip.usuarios_unicos) >= 3 ? "bg-red-500/5" : ""}`}>
                      <td className="p-3 text-xs font-mono">
                        {ip.client_ip}
                        {parseInt(ip.usuarios_unicos) >= 3 && (
                          <ShieldAlert className="inline h-3 w-3 text-red-400 ml-1" />
                        )}
                        {isInternal(ip.client_ip) && (
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

      {/* 500 errors */}
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4 text-red-500" />
              Erros 500 — Falha interna no Kong
              <Badge className="bg-red-700 text-white ml-auto">{serverErrors.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs text-muted-foreground">Horário</th>
                    <th className="text-left p-3 text-xs text-muted-foreground">Username</th>
                    <th className="text-left p-3 text-xs text-muted-foreground">IP</th>
                    <th className="text-left p-3 text-xs text-muted-foreground">Path</th>
                  </tr>
                </thead>
                <tbody>
                  {serverErrors.map((r, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="p-3 text-xs font-mono whitespace-nowrap text-muted-foreground">{formatTimestamp(r.timestamp)}</td>
                      <td className="p-3 text-xs font-mono text-amber-300 max-w-[120px] truncate">{r.username || "—"}</td>
                      <td className="p-3 text-xs font-mono text-muted-foreground">{r.client_ip || "—"}</td>
                      <td className="p-3 text-xs font-mono text-muted-foreground max-w-[140px] truncate">{r.path || "—"}</td>
                    </tr>
                  ))}
                  {!serverErrors.length && <EmptyRow cols={4} />}
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
                  <th className="text-left p-3 text-xs text-muted-foreground">Status</th>
                  <th className="text-left p-3 text-xs text-muted-foreground">Username</th>
                  <th className="text-left p-3 text-xs text-muted-foreground">IP</th>
                  <th className="text-left p-3 text-xs text-muted-foreground">Path</th>
                  <th className="text-left p-3 text-xs text-muted-foreground">Module</th>
                </tr>
              </thead>
              <tbody>
                {recentFailures.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-muted/30">
                    <td className="p-3 text-xs font-mono whitespace-nowrap text-muted-foreground">{formatTimestamp(r.timestamp)}</td>
                    <td className="p-3"><StatusBadge code={r.status_code} /></td>
                    <td className="p-3 text-xs font-mono text-amber-300 max-w-[180px] truncate">{r.username || "—"}</td>
                    <td className="p-3 text-xs font-mono text-muted-foreground">{r.client_ip || "—"}</td>
                    <td className="p-3 text-xs font-mono text-muted-foreground max-w-[160px] truncate">{r.path || "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">{r.module || "—"}</td>
                  </tr>
                ))}
                {!recentFailures.length && <EmptyRow cols={6} />}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value, color, valueColor }: {
  label: string; value: string; color?: string; valueColor?: string;
}) {
  return (
    <Card className={color}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${valueColor || ""}`}>{value}</p>
      </CardContent>
    </Card>
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
