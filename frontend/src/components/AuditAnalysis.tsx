import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Eye,
  RefreshCw,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Globe,
  Users,
} from "lucide-react";
import { eventsApi, type AuditOverview } from "@/lib/api";

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function ServiceBadge({ service }: { service: string }) {
  const colors: Record<string, string> = {
    integra:
      "bg-blue-500/20 text-blue-300 border-blue-500/30",
    customer360:
      "bg-purple-500/20 text-purple-300 border-purple-500/30",
    fieldservice:
      "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  };
  const cls =
    colors[service.toLowerCase()] ??
    "bg-muted/40 text-muted-foreground border-muted";
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${cls}`}>
      {service}
    </span>
  );
}

// ─── loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

export function AuditAnalysis() {
  const [data, setData] = useState<AuditOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    eventsApi
      .auditOverview()
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="p-6 text-center text-red-400">
          <XCircle className="h-8 w-8 mx-auto mb-2" />
          <p className="font-semibold">Erro ao carregar dados de auditoria</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const {
    totals,
    topPages,
    topUsers,
    maskedDataAccess,
    externalIPs,
    suspiciousUsers,
    recentEvents,
  } = data;

  const totalEvents = totals.reduce((sum, t) => sum + t.events, 0);
  const totalMasked = maskedDataAccess.reduce((sum, m) => sum + m.count, 0);
  const services = [...new Set(topPages.map((p) => p.service))];

  // Set of IPs considered external (present in the externalIPs list)
  const externalIPSet = new Set(externalIPs.map((e) => e.ip));

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-blue-400" />
          <h2 className="text-sm font-semibold text-blue-300">
            Auditoria — Logs de Acesso
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Atualizar
        </Button>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total de eventos 24h</p>
            <p className="text-2xl font-bold text-blue-300">
              {totalEvents.toLocaleString("pt-BR")}
            </p>
            <p className="text-xs text-muted-foreground">
              {totals.length} serviço{totals.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        <Card className={totalMasked > 0 ? "border-red-500/30" : ""}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Acessos mascarados</p>
            <p
              className={`text-2xl font-bold ${
                totalMasked > 0 ? "text-red-300" : "text-green-300"
              }`}
            >
              {totalMasked.toLocaleString("pt-BR")}
            </p>
            <p className="text-xs text-muted-foreground">ViewMaskedData</p>
          </CardContent>
        </Card>

        <Card className={externalIPs.length > 0 ? "border-red-500/40 ring-1 ring-red-500/30" : ""}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">IPs externos</p>
            <p
              className={`text-2xl font-bold ${
                externalIPs.length > 0 ? "text-red-300" : "text-green-300"
              }`}
            >
              {externalIPs.length}
            </p>
            <p className="text-xs text-muted-foreground">detectados</p>
          </CardContent>
        </Card>

        <Card className={suspiciousUsers.length > 0 ? "border-yellow-500/30" : ""}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Usuários suspeitos</p>
            <p
              className={`text-2xl font-bold ${
                suspiciousUsers.length > 0 ? "text-yellow-300" : "text-green-300"
              }`}
            >
              {suspiciousUsers.length}
            </p>
            <p className="text-xs text-muted-foreground">alto volume/páginas</p>
          </CardContent>
        </Card>
      </div>

      {/* ── IPs Externos ── */}
      {externalIPs.length > 0 && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4 text-red-400" />
              IPs Externos Detectados
              <Badge
                variant="secondary"
                className="ml-auto bg-red-500/20 text-red-300 border-red-500/30"
              >
                {externalIPs.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 text-muted-foreground">IP</th>
                    <th className="text-left p-3 text-muted-foreground">Usuário</th>
                    <th className="text-left p-3 text-muted-foreground">Página</th>
                    <th className="text-left p-3 text-muted-foreground">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {externalIPs.map((row, i) => (
                    <tr key={i} className="border-b hover:bg-muted/20 bg-red-500/5">
                      <td className="p-3 font-mono text-red-300 font-semibold">
                        {row.ip}
                      </td>
                      <td className="p-3 font-mono text-muted-foreground">
                        {row.userId}
                      </td>
                      <td className="p-3 font-mono text-xs text-muted-foreground max-w-[260px] truncate" title={row.page}>
                        {row.page}
                      </td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">
                        {fmt(row.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Dados Mascarados Acessados ── */}
      {maskedDataAccess.length > 0 && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-orange-400" />
              Acessos a Dados Mascarados
              <Badge variant="secondary" className="ml-auto">
                {maskedDataAccess.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 text-muted-foreground">Usuário</th>
                    <th className="text-left p-3 text-muted-foreground">Serviço</th>
                    <th className="text-right p-3 text-muted-foreground">Acessos mascarados</th>
                  </tr>
                </thead>
                <tbody>
                  {maskedDataAccess.map((row, i) => (
                    <tr key={i} className="border-b hover:bg-muted/20">
                      <td className="p-3 font-mono text-muted-foreground">{row.userId}</td>
                      <td className="p-3">
                        <ServiceBadge service={row.service} />
                      </td>
                      <td className="p-3 text-right">
                        <span
                          className={`font-bold font-mono ${
                            row.count > 10 ? "text-red-300" : "text-orange-300"
                          }`}
                        >
                          {row.count.toLocaleString("pt-BR")}
                        </span>
                        {row.count > 10 && (
                          <Badge
                            variant="secondary"
                            className="ml-2 bg-red-500/20 text-red-300 border-red-500/30 text-[10px]"
                          >
                            alto
                          </Badge>
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

      {/* ── Top Páginas por Serviço ── */}
      {services.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Eye className="h-4 w-4 text-blue-400" />
              Top Páginas por Serviço
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {services.map((svc) => {
              const pages = topPages
                .filter((p) => p.service === svc)
                .sort((a, b) => b.count - a.count);
              if (pages.length === 0) return null;
              const max = pages[0].count;
              return (
                <div key={svc}>
                  <div className="flex items-center gap-2 mb-2">
                    <ServiceBadge service={svc} />
                    <span className="text-xs text-muted-foreground">
                      {pages.length} página{pages.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {pages.map((p, i) => {
                      const pct = max > 0 ? (p.count / max) * 100 : 0;
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span
                            className="font-mono text-muted-foreground truncate"
                            style={{ width: "45%" }}
                            title={p.page}
                          >
                            {p.page}
                          </span>
                          <div className="flex-1 bg-muted/30 rounded h-2 overflow-hidden">
                            <div
                              className="h-2 rounded bg-blue-500/60"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-muted-foreground w-12 text-right font-mono">
                            {p.count.toLocaleString("pt-BR")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Top Usuários por Acesso ── */}
      {topUsers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-400" />
              Top Usuários por Acesso
              <Badge variant="secondary" className="ml-auto">
                {topUsers.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[360px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-muted-foreground">Usuário</th>
                    <th className="text-left p-3 text-muted-foreground">Serviço</th>
                    <th className="text-right p-3 text-muted-foreground">Total acessos</th>
                    <th className="text-right p-3 text-muted-foreground">Dados mascarados</th>
                  </tr>
                </thead>
                <tbody>
                  {topUsers.map((row, i) => {
                    const suspicious = row.maskedAccess > 5;
                    return (
                      <tr
                        key={i}
                        className={`border-b hover:bg-muted/20 ${
                          suspicious ? "bg-yellow-500/10" : ""
                        }`}
                      >
                        <td
                          className={`p-3 font-mono ${
                            suspicious ? "text-yellow-300 font-semibold" : "text-muted-foreground"
                          }`}
                        >
                          {row.userId}
                        </td>
                        <td className="p-3">
                          <ServiceBadge service={row.service} />
                        </td>
                        <td className="p-3 text-right font-mono">
                          {row.count.toLocaleString("pt-BR")}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {row.maskedAccess > 0 ? (
                            <span
                              className={
                                row.maskedAccess > 5
                                  ? "text-yellow-300 font-bold"
                                  : "text-muted-foreground"
                              }
                            >
                              {row.maskedAccess.toLocaleString("pt-BR")}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
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

      {/* ── Usuários Suspeitos ── */}
      {suspiciousUsers.length > 0 && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-400" />
              Usuários Suspeitos
              <Badge variant="secondary" className="ml-auto">
                {suspiciousUsers.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 text-muted-foreground">Usuário</th>
                    <th className="text-left p-3 text-muted-foreground">Serviço</th>
                    <th className="text-right p-3 text-muted-foreground">Total eventos</th>
                    <th className="text-right p-3 text-muted-foreground">Páginas únicas</th>
                  </tr>
                </thead>
                <tbody>
                  {suspiciousUsers.map((row, i) => (
                    <tr key={i} className="border-b hover:bg-muted/20">
                      <td className="p-3 font-mono text-yellow-300 font-semibold">
                        {row.userId}
                      </td>
                      <td className="p-3">
                        <ServiceBadge service={row.service} />
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-yellow-300">
                        {row.count.toLocaleString("pt-BR")}
                      </td>
                      <td className="p-3 text-right font-mono text-muted-foreground">
                        {row.uniquePages.toLocaleString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Eventos Recentes ── */}
      {recentEvents.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              Eventos Recentes
              <Badge variant="secondary" className="ml-auto">
                {Math.min(recentEvents.length, 30)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[480px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-muted-foreground whitespace-nowrap">
                      Timestamp
                    </th>
                    <th className="text-left p-2 text-muted-foreground">Serviço</th>
                    <th className="text-left p-2 text-muted-foreground">Usuário</th>
                    <th className="text-left p-2 text-muted-foreground">IP</th>
                    <th className="text-left p-2 text-muted-foreground">Página</th>
                    <th className="text-left p-2 text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.slice(0, 30).map((ev, i) => {
                    const isExternal = externalIPSet.has(ev.ip);
                    return (
                      <tr
                        key={i}
                        className={`border-b hover:bg-muted/20 ${
                          isExternal
                            ? "bg-red-500/10"
                            : ev.masked
                            ? "bg-orange-500/5"
                            : ""
                        }`}
                      >
                        <td className="p-2 font-mono text-muted-foreground whitespace-nowrap">
                          {fmt(ev.timestamp)}
                        </td>
                        <td className="p-2">
                          <ServiceBadge service={ev.service} />
                        </td>
                        <td
                          className={`p-2 font-mono ${
                            isExternal ? "text-red-300 font-semibold" : "text-muted-foreground"
                          }`}
                        >
                          {ev.userId}
                        </td>
                        <td
                          className={`p-2 font-mono ${
                            isExternal ? "text-red-300 font-bold" : "text-muted-foreground"
                          }`}
                        >
                          {ev.ip}
                        </td>
                        <td
                          className="p-2 font-mono text-muted-foreground max-w-[200px] truncate"
                          title={ev.page}
                        >
                          {ev.page}
                        </td>
                        <td className="p-2">
                          {ev.masked && (
                            <Badge
                              variant="secondary"
                              className="bg-orange-500/20 text-orange-300 border-orange-500/30 text-[10px] whitespace-nowrap"
                            >
                              MASCARADO
                            </Badge>
                          )}
                          {isExternal && (
                            <Badge
                              variant="secondary"
                              className="ml-1 bg-red-500/20 text-red-300 border-red-500/30 text-[10px] whitespace-nowrap"
                            >
                              IP EXT
                            </Badge>
                          )}
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
