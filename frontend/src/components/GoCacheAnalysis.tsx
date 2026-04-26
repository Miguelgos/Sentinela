import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, AlertTriangle, Bot, Globe, XCircle, Flame } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend, Cell,
} from "recharts";
import { eventsApi, type GoCacheEvent, type GoCacheOverview } from "@/lib/api";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function ts(unix: number) {
  return format(new Date(unix * 1000), "dd/MM HH:mm:ss", { locale: ptBR });
}

function ActionBadge({ action }: { action: string }) {
  const cls =
    action === "block"     ? "bg-red-500/20 text-red-300 border-red-500/30" :
    action === "simulate"  ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" :
    action === "challenge" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" :
    "bg-muted text-muted-foreground";
  return <span className={`text-xs font-bold px-2 py-0.5 rounded border ${cls}`}>{action}</span>;
}


function EventsTable({ events, title, icon }: { events: GoCacheEvent[]; title: string; icon: React.ReactNode }) {
  if (!events.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {icon}
          {title}
          <Badge variant="error" className="ml-auto">{events.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto max-h-[320px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="border-b bg-muted/50">
                <th className="text-left p-2 text-muted-foreground">Hora</th>
                <th className="text-left p-2 text-muted-foreground">IP</th>
                <th className="text-left p-2 text-muted-foreground">Host</th>
                <th className="text-left p-2 text-muted-foreground">URI</th>
                <th className="text-left p-2 text-muted-foreground">Alerta</th>
                <th className="text-left p-2 text-muted-foreground">Ação</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-b hover:bg-muted/20">
                  <td className="p-2 font-mono whitespace-nowrap">{ts(ev.timestamp)}</td>
                  <td className="p-2 font-mono text-amber-300">{ev.ip}</td>
                  <td className="p-2 text-muted-foreground">{ev.host.replace(".ituran.com.br","")}</td>
                  <td className="p-2 font-mono text-xs max-w-[200px] truncate" title={ev.uri}>
                    {ev.uri.split("?")[0]}
                  </td>
                  <td className="p-2">
                    {ev.alerts.slice(0,1).map((a, i) => (
                      <span key={i} className="text-red-300">{a.msg.trim()}</span>
                    ))}
                  </td>
                  <td className="p-2"><ActionBadge action={ev.action} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function GoCacheAnalysis() {
  const [data, setData] = useState<GoCacheOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    eventsApi.gocacheOverview()
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
          <p className="font-semibold">Erro ao conectar com GoCache</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const {
    summary, topIPs, topAlerts, topURIs, topHosts, recentWaf, recentFirewall, recentBot,
    totals, timeline, byCountry, attackCategories, botTypes, userAgentTools,
  } = data;
  const botBlockedDisplay   = totals ? totals.bot    : summary.botBlocked;
  const botSimulateDisplay  = totals ? totals.botSim : summary.botSimulate;
  const totalBlocked = summary.wafBlocked + summary.firewallBlocked + botBlockedDisplay;

  const alertChartData = topAlerts.slice(0, 8).map((a) => ({
    name: a.id.replace(/-/g, " ").slice(0, 28),
    count: a.count,
  }));

  const uriChartData = topURIs.slice(0, 8).map((u) => ({
    name: u.uri.slice(-35),
    count: u.count,
  }));

  const timelineData = (timeline ?? []).map((t) => ({
    hour: t.hour.slice(11, 16), // HH:MM
    waf: t.waf,
    bot: t.bot,
    firewall: t.firewall,
  }));

  const categoryColors: Record<string, string> = {
    "SQL Injection":   "#dc2626",
    "XSS / Script":    "#ea580c",
    "Path Traversal":  "#eab308",
    "Scanner/Probe":   "#3b82f6",
    "Protocol/Header": "#6b7280",
    "Outros":          "#94a3b8",
  };
  const categoryChartData = (attackCategories ?? []).map((c) => ({
    name: c.category,
    count: c.count,
    fill: categoryColors[c.category] ?? "#94a3b8",
  }));

  const countryChartData = (byCountry ?? []).slice(0, 10).map((c) => ({
    name: c.country || "??",
    count: c.count,
  }));

  return (
    <div className="space-y-6">
      {/* Context banner */}
      <Card className="border-orange-500/30 bg-orange-500/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Flame className="h-5 w-5 text-orange-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-orange-300">
                GoCache WAF — {data.domains.join(", ")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                <strong className="text-foreground">{totalBlocked.toLocaleString("pt-BR")}</strong> ataques bloqueados
                e <strong className="text-foreground">{botSimulateDisplay.toLocaleString("pt-BR")}</strong> bots detectados (modo monitor) nas últimas 24h
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-red-500/40 ring-1 ring-red-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <Shield className="h-6 w-6 text-red-400 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">WAF Bloqueados</p>
              <p className="text-2xl font-bold text-red-300">{summary.wafBlocked.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-muted-foreground">SQL/XSS/Injeção</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-orange-500/40">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-orange-400 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Firewall Bloqueados</p>
              <p className="text-2xl font-bold text-orange-300">{summary.firewallBlocked.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-muted-foreground">IPs na blacklist</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-purple-500/40">
          <CardContent className="p-4 flex items-center gap-3">
            <Bot className="h-6 w-6 text-purple-400 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Bots Bloqueados</p>
              <p className="text-2xl font-bold text-purple-300">{botBlockedDisplay.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-muted-foreground">Detectados como bot</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/30">
          <CardContent className="p-4 flex items-center gap-3">
            <Bot className="h-6 w-6 text-yellow-400 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Bots (monitor)</p>
              <p className="text-2xl font-bold text-yellow-300">{botSimulateDisplay.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-muted-foreground">Modo simulação</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top attack types chart */}
        {alertChartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-red-400" />
                Tipos de Ataque WAF — Top 8
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={alertChartData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 8 }} width={170} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  />
                  <Bar dataKey="count" fill="#dc2626" name="Bloqueios" radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Top attacked URIs */}
        {uriChartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Globe className="h-4 w-4 text-orange-400" />
                URIs Mais Atacadas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={uriChartData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 8 }} width={170} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  />
                  <Bar dataKey="count" fill="#ea580c" name="Ataques" radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top IPs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Top IPs Atacantes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[280px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-muted-foreground">#</th>
                    <th className="text-left p-2 text-muted-foreground">IP</th>
                    <th className="text-right p-2 text-muted-foreground">Eventos</th>
                  </tr>
                </thead>
                <tbody>
                  {topIPs.map((ip, i) => (
                    <tr key={ip.ip} className="border-b hover:bg-muted/20">
                      <td className="p-2 text-muted-foreground">{i + 1}</td>
                      <td className="p-2 font-mono text-amber-300">{ip.ip}</td>
                      <td className="p-2 text-right">
                        <Badge variant="error">{ip.count}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Top hosts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-400" />
              Hosts Mais Visados
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[280px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-muted-foreground">Host</th>
                    <th className="text-right p-2 text-muted-foreground">Ataques</th>
                  </tr>
                </thead>
                <tbody>
                  {topHosts.map((h) => (
                    <tr key={h.host} className="border-b hover:bg-muted/20">
                      <td className="p-2 font-mono">{h.host}</td>
                      <td className="p-2 text-right">
                        <Badge variant="error">{h.count}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Timeline (24h) — WAF / Bot / Firewall */}
      {timelineData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-400" />
              Linha do Tempo — últimas 24h
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="waf"      name="WAF"      stroke="#dc2626" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="bot"      name="Bot"      stroke="#a855f7" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="firewall" name="Firewall" stroke="#ea580c" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Attack categories */}
        {categoryChartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-red-400" />
                Categorias de Ataque (WAF)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={categoryChartData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  />
                  <Bar dataKey="count" name="Eventos" radius={[0,3,3,0]}>
                    {categoryChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Country breakdown */}
        {countryChartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Globe className="h-4 w-4 text-blue-400" />
                Países de Origem — Top 10
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={countryChartData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={60} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  />
                  <Bar dataKey="count" fill="#3b82f6" name="Eventos" radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bot types table */}
        {botTypes && botTypes.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Bot className="h-4 w-4 text-purple-400" />
                Tipos de Bot Bloqueados
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[280px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-2 text-muted-foreground">Tipo</th>
                      <th className="text-right p-2 text-muted-foreground">Eventos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {botTypes.map((b) => (
                      <tr key={b.type} className="border-b hover:bg-muted/20">
                        <td className="p-2 font-mono text-purple-300">{b.type}</td>
                        <td className="p-2 text-right">
                          <Badge variant="error">{b.count}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* User-Agent tools table */}
        {userAgentTools && userAgentTools.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Ferramentas / User-Agent
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[280px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-2 text-muted-foreground">Ferramenta</th>
                      <th className="text-right p-2 text-muted-foreground">Eventos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userAgentTools.map((u) => (
                      <tr key={u.tool} className="border-b hover:bg-muted/20">
                        <td className="p-2 font-mono text-amber-300">{u.tool}</td>
                        <td className="p-2 text-right">
                          <Badge variant="error">{u.count}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Event tables */}
      <EventsTable
        events={recentWaf}
        title={`Eventos WAF Bloqueados — últimos ${recentWaf.length}`}
        icon={<Shield className="h-4 w-4 text-red-400" />}
      />
      <EventsTable
        events={recentFirewall}
        title={`Firewall — IPs Bloqueados — últimos ${recentFirewall.length}`}
        icon={<AlertTriangle className="h-4 w-4 text-orange-400" />}
      />
      <EventsTable
        events={recentBot}
        title={`Bots Detectados (monitor) — últimos ${recentBot.length}`}
        icon={<Bot className="h-4 w-4 text-purple-400" />}
      />
    </div>
  );
}
