import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EventDetail } from "@/components/EventDetail";
import { AlertTriangle, Clock, Users, TrendingUp, FileDown } from "lucide-react";
import { exportErrorAnalysisPdf } from "@/lib/exportPdf";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { eventsApi, pessoaApi, type DbEvent, type EventsResponse } from "@/lib/api";

const errorAnalysisChartConfig = {
  erros:    { label: "Erros",           color: "#ef4444" },
  usuarios: { label: "Usuários únicos", color: "#a855f7" },
} satisfies ChartConfig;
import { EMPTY_GUID, formatTimestamp } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function ErrorAnalysis() {
  const [emptyGuidEvents, setEmptyGuidEvents] = useState<EventsResponse | null>(null);
  const [timeline, setTimeline] = useState<{ hour: string; count: string; unique_users: string }[]>([]);
  const [selected, setSelected] = useState<DbEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!emptyGuidEvents) return;
    setExporting(true);
    try { exportErrorAnalysisPdf(emptyGuidEvents, timeline, names); }
    finally { setExporting(false); }
  }

  useEffect(() => {
    Promise.all([
      eventsApi.list({ emptyGuidOnly: true, pageSize: 100 }),
      eventsApi.emptyGuidTimeline(),
    ])
      .then(([e, t]) => {
        setEmptyGuidEvents(e);
        setTimeline(t);
        const ids = [...new Set(e.data.map((ev) => ev.user_id).filter(Boolean))] as string[];
        if (ids.length > 0) {
          pessoaApi.lookup(ids).then(setNames).catch(() => {});
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-32 w-full" /></CardContent></Card>)}</div>;

  const uniqueUsers = new Set(emptyGuidEvents?.data.map((e) => e.user_id).filter(Boolean)).size;
  const peak = timeline.reduce((max, t) => parseInt(t.count) > parseInt(max.count || "0") ? t : max, { hour: "", count: "0", unique_users: "0" });

  const chartData = timeline.map((t) => ({
    hora: format(new Date(t.hour), "dd/MM HH:mm", { locale: ptBR }),
    erros: parseInt(t.count),
    usuarios: parseInt(t.unique_users),
  }));

  return (
    <>
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || !emptyGuidEvents} className="gap-2">
            <FileDown className="h-4 w-4" />
            {exporting ? "Gerando PDF…" : "Exportar PDF"}
          </Button>
        </div>
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-orange-300">Problema identificado: GUID de Cotação vazio</p>
                <p className="text-xs text-muted-foreground mt-1">
                  O endpoint <code className="bg-muted px-1 rounded">Quote/PrintItens</code> está sendo chamado com{" "}
                  <code className="bg-muted px-1 rounded text-red-400">{EMPTY_GUID}</code> como{" "}
                  <code className="bg-muted px-1 rounded">GUID_COTACAO</code>. Isso indica que o frontend está acionando a impressão
                  antes de obter ou definir um ID de cotação válido. O backend não consegue encontrar a cotação e retorna erro.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            icon={<AlertTriangle className="h-5 w-5 text-red-400" />}
            label="Total de Erros (GUID vazio)"
            value={(emptyGuidEvents?.total || 0).toLocaleString("pt-BR")}
            color="border-red-500/30"
          />
          <MetricCard
            icon={<Users className="h-5 w-5 text-purple-400" />}
            label="Usuários Afetados"
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
                <Clock className="h-4 w-4 text-orange-400" />
                Timeline de Erros — GUID vazio por hora
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={errorAnalysisChartConfig} className="h-[200px] w-full">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="errGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="hora" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="erros" stroke="#ef4444" fill="url(#errGrad)" name="Erros" />
                  <Area type="monotone" dataKey="usuarios" stroke="#a855f7" fill="transparent" strokeDasharray="4 2" name="Usuários únicos" />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Requisições com GUID vazio
              <Badge variant="error" className="ml-2">{emptyGuidEvents?.total || 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-xs text-muted-foreground">Data/Hora</th>
                    <th className="text-left p-2 text-xs text-muted-foreground">UserId</th>
                    <th className="text-left p-2 text-xs text-muted-foreground">Nome</th>
                    <th className="text-left p-2 text-xs text-muted-foreground">Trace ID</th>
                    <th className="text-left p-2 text-xs text-muted-foreground">Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {emptyGuidEvents?.data.map((event) => (
                    <tr
                      key={event.id}
                      className="border-b hover:bg-muted/50 cursor-pointer"
                      onClick={() => setSelected(event)}
                    >
                      <td className="p-2 text-xs font-mono whitespace-nowrap">{formatTimestamp(event.timestamp)}</td>
                      <td className="p-2 text-xs font-mono">{event.user_id || "—"}</td>
                      <td className="p-2 text-xs">
                        {event.user_id && names[event.user_id]
                          ? names[event.user_id]
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 text-xs font-mono text-muted-foreground">
                        {event.trace_id ? event.trace_id.slice(0, 16) + "…" : "—"}
                      </td>
                      <td className="p-2 text-xs text-red-400 max-w-xs line-clamp-1">
                        {event.message?.match(/Error: (.+)/)?.[1] || event.message?.slice(0, 80)}
                      </td>
                    </tr>
                  ))}
                  {(!emptyGuidEvents || emptyGuidEvents.data.length === 0) && (
                    <tr><td colSpan={4} className="p-4 text-center text-muted-foreground text-sm">Nenhum evento encontrado</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <EventDetail event={selected} onClose={() => setSelected(null)} />
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
