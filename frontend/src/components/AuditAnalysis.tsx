import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Eye,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  Globe,
  Users,
} from "lucide-react";
import { eventsApi, pessoaApi, type AuditOverview } from "@/lib/api";
import { useAnalysisData } from "@/hooks/useAnalysisData";
import { AnalysisShell } from "@/components/AnalysisShell";

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

// ─── main component ──────────────────────────────────────────────────────────

export function AuditAnalysis() {
  const { data, loading, error, reload } = useAnalysisData(() => eventsApi.auditOverview());
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!data) return;
    const ids = [
      ...new Set([
        ...data.topUsers.map((u) => u.userId),
        ...data.unmaskedDataAccess.map((u) => u.userId),
        ...data.suspiciousUsers.map((u) => u.userId),
        ...data.recentEvents.map((e) => e.userId),
        ...data.externalIPs.map((e) => e.userId),
      ]),
    ].filter((id) => id && id !== "unknown");
    if (ids.length > 0) pessoaApi.lookup(ids).then(setNames).catch(() => {});
  }, [data]);

  return (
    <AnalysisShell
      loading={loading}
      error={error}
      onReload={reload}
      skeletonRows={5}
      action={
        <Button variant="outline" size="sm" onClick={reload}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Atualizar
        </Button>
      }
    >
      {data && <AuditContent data={data} names={names} />}
    </AnalysisShell>
  );
}

function UserCell({ userId, names }: { userId: string; names: Record<string, string> }) {
  const name = names[userId];
  if (name) {
    return <span className="truncate max-w-[180px] block">{name}</span>;
  }
  return <span className="font-mono text-muted-foreground">#{userId}</span>;
}

function AuditContent({ data, names }: { data: AuditOverview; names: Record<string, string> }) {
  const {
    totals,
    topPages,
    topUsers,
    unmaskedDataAccess,
    externalIPs,
    suspiciousUsers,
    recentEvents,
  } = data;

  const totalEvents = totals.reduce((sum, t) => sum + t.events, 0);
  const totalUnmasked = unmaskedDataAccess.reduce((sum, m) => sum + m.count, 0);
  const services = [...new Set(topPages.map((p) => p.service))];

  // Set of IPs considered external (present in the externalIPs list)
  const externalIPSet = new Set(externalIPs.map((e) => e.ip));

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center gap-2">
        <Eye className="h-5 w-5 text-blue-400" />
        <h2 className="text-sm font-semibold text-blue-300">
          Auditoria — Logs de Acesso
        </h2>
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

        <Card className={totalUnmasked > 0 ? "border-red-500/30" : ""}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Acessos a dados desmascarados</p>
            <p
              className={`text-2xl font-bold ${
                totalUnmasked > 0 ? "text-red-300" : "text-green-300"
              }`}
            >
              {totalUnmasked.toLocaleString("pt-BR")}
            </p>
            <p className="text-xs text-muted-foreground">Visualização do dado real (LGPD)</p>
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
                      <td className="p-3"><UserCell userId={row.userId} names={names} /></td>
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

      {/* ── Acessos a Dados Desmascarados (LGPD) ── */}
      {unmaskedDataAccess.length > 0 && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-orange-400" />
              Acessos a Dados Desmascarados (visualização do dado real)
              <Badge variant="secondary" className="ml-auto">
                {unmaskedDataAccess.length}
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
                    <th className="text-right p-3 text-muted-foreground">Visualizações sem máscara</th>
                  </tr>
                </thead>
                <tbody>
                  {unmaskedDataAccess.map((row, i) => (
                    <tr key={i} className="border-b hover:bg-muted/20">
                      <td className="p-3"><UserCell userId={row.userId} names={names} /></td>
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
                    <th className="text-right p-3 text-muted-foreground">Dados desmascarados</th>
                  </tr>
                </thead>
                <tbody>
                  {topUsers.map((row, i) => {
                    const suspicious = row.unmaskedAccess > 5;
                    return (
                      <tr
                        key={i}
                        className={`border-b hover:bg-muted/20 ${
                          suspicious ? "bg-yellow-500/10" : ""
                        }`}
                      >
                        <td className="p-3">
                          <UserCell userId={row.userId} names={names} />
                        </td>
                        <td className="p-3">
                          <ServiceBadge service={row.service} />
                        </td>
                        <td className="p-3 text-right font-mono">
                          {row.count.toLocaleString("pt-BR")}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {row.unmaskedAccess > 0 ? (
                            <span
                              className={
                                row.unmaskedAccess > 5
                                  ? "text-yellow-300 font-bold"
                                  : "text-muted-foreground"
                              }
                            >
                              {row.unmaskedAccess.toLocaleString("pt-BR")}
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
                    <th className="text-right p-3 text-muted-foreground">Dados desmascarados</th>
                  </tr>
                </thead>
                <tbody>
                  {suspiciousUsers.map((row, i) => {
                    const unmasked = topUsers.find(
                      (u) => u.userId === row.userId && u.service === row.service
                    )?.unmaskedAccess ?? 0;
                    return (
                      <tr key={i} className="border-b hover:bg-muted/20">
                        <td className="p-3">
                          <UserCell userId={row.userId} names={names} />
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
                        <td className="p-3 text-right font-mono">
                          {unmasked > 0 ? (
                            <span className={unmasked > 10 ? "text-red-300 font-bold" : "text-orange-300"}>
                              {unmasked.toLocaleString("pt-BR")}
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
                            : ev.unmasked
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
                        <td className="p-2">
                          <UserCell userId={ev.userId} names={names} />
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
                          {ev.unmasked && (
                            <Badge
                              variant="secondary"
                              className="bg-orange-500/20 text-orange-300 border-orange-500/30 text-[10px] whitespace-nowrap"
                              title="Usuário visualizou os dados sem máscara (dado real)"
                            >
                              DADO REAL
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
