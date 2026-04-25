import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { LevelBadge } from "@/components/LevelBadge";
import { EventDetail } from "@/components/EventDetail";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { eventsApi, pessoaApi, type DbEvent, type EventsResponse, type EventFilters } from "@/lib/api";
import { formatTimestamp, isEmptyGuid, truncate } from "@/lib/utils";

export function LogsTable() {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DbEvent | null>(null);
  const [filters, setFilters] = useState<EventFilters>({ page: 1, pageSize: 50 });
  const [search, setSearch] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async (f: EventFilters) => {
    setLoading(true);
    try {
      const res = await eventsApi.list(f);
      setData(res);
      const ids = [...new Set(res.data.map((e) => e.user_id).filter(Boolean))] as string[];
      if (ids.length > 0) {
        pessoaApi.lookup(ids).then(setNames).catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [filters, load]);

  const applySearch = () => {
    setFilters((f) => ({ ...f, search, page: 1 }));
  };

  const setFilter = (key: keyof EventFilters, value: string | boolean | undefined) => {
    setFilters((f) => ({ ...f, [key]: value || undefined, page: 1 }));
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Eventos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="flex gap-1 flex-1 min-w-[200px]">
              <Input
                placeholder="Buscar na mensagem..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applySearch()}
                className="h-9"
              />
              <Button size="sm" onClick={applySearch} variant="outline">
                <Search className="h-4 w-4" />
              </Button>
            </div>

            <Select
              value={filters.level || "all"}
              onValueChange={(v) => setFilter("level", v === "all" ? undefined : v)}
            >
              <SelectTrigger className="w-36 h-9">
                <SelectValue placeholder="Nível" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="Error">Error</SelectItem>
                <SelectItem value="Warning">Warning</SelectItem>
                <SelectItem value="Information">Information</SelectItem>
                <SelectItem value="Debug">Debug</SelectItem>
              </SelectContent>
            </Select>

            <Button
              size="sm"
              variant={filters.emptyGuidOnly ? "default" : "outline"}
              onClick={() => setFilter("emptyGuidOnly", !filters.emptyGuidOnly || undefined)}
              className="h-9 gap-1"
            >
              <AlertTriangle className="h-3 w-3" />
              GUID vazio
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setSearch(""); setFilters({ page: 1, pageSize: 50 }); }}
              className="h-9"
            >
              Limpar
            </Button>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 font-medium text-xs text-muted-foreground w-36">Data/Hora</th>
                  <th className="text-left p-2 font-medium text-xs text-muted-foreground w-24">Nível</th>
                  <th className="text-left p-2 font-medium text-xs text-muted-foreground w-24">Serviço</th>
                  <th className="text-left p-2 font-medium text-xs text-muted-foreground">Mensagem</th>
                  <th className="text-left p-2 font-medium text-xs text-muted-foreground w-40">Usuário</th>
                  <th className="text-left p-2 font-medium text-xs text-muted-foreground w-36">GUID Cotação</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 10 }).map((_, i) => (
                      <tr key={i} className="border-b">
                        {Array.from({ length: 6 }).map((_, j) => (
                          <td key={j} className="p-2"><Skeleton className="h-4 w-full" /></td>
                        ))}
                      </tr>
                    ))
                  : data?.data.map((event) => (
                      <tr
                        key={event.id}
                        className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => setSelected(event)}
                      >
                        <td className="p-2 text-xs text-muted-foreground font-mono whitespace-nowrap">
                          {formatTimestamp(event.timestamp)}
                        </td>
                        <td className="p-2"><LevelBadge level={event.level} /></td>
                        <td className="p-2 text-xs">{event.service || "—"}</td>
                        <td className="p-2 text-xs max-w-sm">
                          <span className="line-clamp-2">{truncate(event.message || "", 100)}</span>
                        </td>
                        <td className="p-2 text-xs">
                          {event.user_id
                            ? <div>
                                {names[event.user_id] && <p className="truncate max-w-[140px]">{names[event.user_id]}</p>}
                                <p className="font-mono text-muted-foreground">#{event.user_id}</p>
                              </div>
                            : "—"}
                        </td>
                        <td className="p-2 text-xs">
                          {event.guid_cotacao ? (
                            isEmptyGuid(event.guid_cotacao) ? (
                              <span className="text-red-400 font-mono flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                vazio
                              </span>
                            ) : (
                              <span className="font-mono text-muted-foreground">{event.guid_cotacao.slice(0, 8)}…</span>
                            )
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>

          {data && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{data.total.toLocaleString("pt-BR")} eventos encontrados</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm" variant="ghost" className="h-7 w-7 p-0"
                  disabled={filters.page === 1}
                  onClick={() => setFilters((f) => ({ ...f, page: (f.page || 1) - 1 }))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>Pág. {data.page} / {data.totalPages}</span>
                <Button
                  size="sm" variant="ghost" className="h-7 w-7 p-0"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setFilters((f) => ({ ...f, page: (f.page || 1) + 1 }))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <EventDetail event={selected} onClose={() => setSelected(null)} />
    </>
  );
}
