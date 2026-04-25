import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Activity, Bug, Users, Hash, ShieldAlert, FileDown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { eventsApi, pessoaApi, type StatsSummary, type TimelineEntry, type AuthErrorStats } from "@/lib/api";
import { EMPTY_GUID } from "@/lib/utils";
import { format } from "date-fns";
import { exportDashboardPdf } from "@/lib/exportPdf";

const COLORS = {
  Error: "#ef4444",
  Warning: "#f59e0b",
  Information: "#3b82f6",
  Debug: "#6b7280",
  Fatal: "#dc2626",
  Verbose: "#9ca3af",
};

export function Dashboard() {
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [authStats, setAuthStats] = useState<AuthErrorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!stats) return;
    setExporting(true);
    try { exportDashboardPdf(stats, timeline, names, authStats); }
    finally { setExporting(false); }
  }

  useEffect(() => {
    Promise.all([eventsApi.stats(), eventsApi.timeline(24), eventsApi.authErrorStats()])
      .then(([s, t, a]) => {
        setStats(s);
        setTimeline(t);
        setAuthStats(a);
        const ids = s.topUsers.map((u) => u.user_id).filter(Boolean);
        if (ids.length > 0) {
          pessoaApi.lookup(ids).then(setNames).catch(() => {});
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardSkeleton />;
  if (!stats) return null;

  const emptyGuid = parseInt(stats.guidBreakdown?.empty_guid || "0");
  const validGuid = parseInt(stats.guidBreakdown?.valid_guid || "0");
  const totalWithGuid = emptyGuid + validGuid;
  const emptyPct = totalWithGuid > 0 ? ((emptyGuid / totalWithGuid) * 100).toFixed(1) : "0";

  const pieData = stats.byLevel.map((l) => ({
    name: l.level,
    value: parseInt(l.count),
  }));

  const timelineMap: Record<string, Record<string, number>> = {};
  for (const entry of timeline) {
    const hour = format(new Date(entry.hour), "HH:mm");
    if (!timelineMap[hour]) timelineMap[hour] = {};
    timelineMap[hour][entry.level] = parseInt(entry.count);
  }
  const timelineData = Object.entries(timelineMap).map(([hour, levels]) => ({
    hour, ...levels,
  }));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || !stats} className="gap-2">
          <FileDown className="h-4 w-4" />
          {exporting ? "Gerando PDF…" : "Exportar PDF"}
        </Button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          title="Total de Eventos"
          value={stats.total.toLocaleString("pt-BR")}
          icon={<Activity className="h-5 w-5 text-blue-400" />}
          color="border-blue-500/30"
        />
        <StatCard
          title="Erros"
          value={stats.errors.toLocaleString("pt-BR")}
          icon={<AlertTriangle className="h-5 w-5 text-red-400" />}
          color="border-red-500/30"
          alert={stats.errors > 0}
        />
        <StatCard
          title="GUID Vazio"
          value={emptyGuid.toLocaleString("pt-BR")}
          subtitle={`${emptyPct}% das cotações`}
          icon={<Bug className="h-5 w-5 text-orange-400" />}
          color="border-orange-500/30"
          alert={emptyGuid > 0}
        />
        <StatCard
          title="Falhas de Auth"
          value={(authStats?.total || 0).toLocaleString("pt-BR")}
          subtitle={authStats && authStats.topUsers.length > 0 ? `${authStats.topUsers.length} usuário(s)` : undefined}
          icon={<ShieldAlert className="h-5 w-5 text-red-400" />}
          color="border-red-500/30"
          alert={(authStats?.total || 0) > 0}
        />
        <StatCard
          title="Usuários Afetados"
          value={stats.topUsers.length.toLocaleString("pt-BR")}
          icon={<Users className="h-5 w-5 text-purple-400" />}
          color="border-purple-500/30"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Timeline — Últimas 24h</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={timelineData}>
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
                {Object.keys(COLORS).map((level) => (
                  <Bar key={level} dataKey={level} stackId="a" fill={COLORS[level as keyof typeof COLORS]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Distribuição por Nível</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={COLORS[entry.name as keyof typeof COLORS] || "#6b7280"} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-orange-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Bug className="h-4 w-4 text-orange-400" />
              GUID Cotação — Quote/PrintItens
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 p-3 text-sm text-orange-300">
              <strong>{emptyPct}%</strong> das requisições chegam com GUID vazio (<code>{EMPTY_GUID}</code>), indicando que o frontend aciona o endpoint sem um ID de cotação válido.
            </div>
            <div className="space-y-2">
              <GuidRow label="GUID vazio (erro)" value={emptyGuid} total={totalWithGuid} color="bg-red-500" />
              <GuidRow label="GUID válido" value={validGuid} total={totalWithGuid} color="bg-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-400" />
              Falhas de Autenticação — /connect/token
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-300">
              <strong>{authStats?.total || 0}</strong> falha(s) no fluxo ResourceOwner.
              {authStats && authStats.topClients[0] && (
                <> Cliente: <code className="bg-muted px-1 rounded">{authStats.topClients[0].client_id}</code>.</>
              )}
            </div>
            <div className="space-y-1">
              {authStats?.topUsers.slice(0, 5).map((u, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-amber-300 truncate">{u.email}</span>
                  <Badge variant="error" className="shrink-0 ml-2">{u.count}</Badge>
                </div>
              ))}
              {(!authStats || authStats.topUsers.length === 0) && (
                <p className="text-xs text-muted-foreground">Nenhuma falha registrada</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Hash className="h-4 w-4 text-blue-400" />
              Top Erros
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.topErrors.slice(0, 5).map((err, i) => (
                <div key={i} className="flex items-start justify-between gap-2 text-xs">
                  <p className="text-muted-foreground line-clamp-2 flex-1">{err.message}</p>
                  <Badge variant="error" className="shrink-0">{err.count}</Badge>
                </div>
              ))}
              {stats.topErrors.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum erro encontrado</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-400" />
              Usuários com Mais Erros
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.topUsers.slice(0, 8).map((u, i) => (
                <div key={i} className="flex items-center justify-between text-sm gap-2">
                  <div className="min-w-0">
                    {names[u.user_id]
                      ? <p className="text-sm truncate">{names[u.user_id]}</p>
                      : null}
                    <p className="font-mono text-xs text-muted-foreground">#{u.user_id}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">{u.count}</Badge>
                </div>
              ))}
              {stats.topUsers.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum dado</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Serviços</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.topServices.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <Badge variant="outline">{s.service}</Badge>
                  <span className="text-muted-foreground">{s.count}</span>
                </div>
              ))}
              {stats.topServices.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum dado</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  title, value, subtitle, icon, color, alert,
}: {
  title: string; value: string; subtitle?: string; icon: React.ReactNode;
  color?: string; alert?: boolean;
}) {
  return (
    <Card className={`${color || ""} ${alert ? "ring-1 ring-red-500/30" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

function GuidRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span>{value.toLocaleString("pt-BR")} ({pct.toFixed(1)}%)</span>
      </div>
      <div className="h-2 bg-muted rounded-full">
        <div className={`h-2 ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2"><CardContent className="p-4"><Skeleton className="h-48 w-full" /></CardContent></Card>
        <Card><CardContent className="p-4"><Skeleton className="h-48 w-full" /></CardContent></Card>
      </div>
    </div>
  );
}
