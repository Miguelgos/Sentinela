import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldAlert, Zap, Code, Eye, AlertTriangle, Users, Hash,
  Activity, Key, Lock, Cpu, RefreshCw, MapPin, Database, FileDown,
} from "lucide-react";
import { eventsApi, type SecurityStats } from "@/lib/api";
import { exportSecurityPdf } from "@/lib/exportPdf";
import { formatTimestamp } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low";

const SEV_LABEL: Record<Severity, string> = {
  critical: "CRÍTICO", high: "ALTO", medium: "MÉDIO", low: "BAIXO",
};
const SEV_CARD: Record<Severity, string> = {
  critical: "border-red-600/40 bg-red-600/5",
  high:     "border-orange-500/40 bg-orange-500/5",
  medium:   "border-yellow-500/40 bg-yellow-500/5",
  low:      "border-blue-500/40 bg-blue-500/5",
};
const SEV_BADGE: Record<Severity, string> = {
  critical: "bg-red-600/20 text-red-300 border border-red-600/30",
  high:     "bg-orange-500/20 text-orange-300 border border-orange-500/30",
  medium:   "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  low:      "bg-blue-500/20 text-blue-300 border border-blue-500/30",
};
const SEV_TEXT: Record<Severity, string> = {
  critical: "text-red-300", high: "text-orange-300", medium: "text-yellow-300", low: "text-blue-300",
};

function SevBadge({ sev }: { sev: Severity }) {
  return <span className={`text-xs font-bold px-2 py-0.5 rounded ${SEV_BADGE[sev]}`}>{SEV_LABEL[sev]}</span>;
}

function FindingCard({ id, sev, title, icon, action, children }: {
  id: string; sev: Severity; title: string; icon: React.ReactNode; action: string; children: React.ReactNode;
}) {
  return (
    <Card className={`${SEV_CARD[sev]} border`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-start gap-2 flex-wrap">
          <span className={`mt-0.5 shrink-0 ${SEV_TEXT[sev]}`}>{icon}</span>
          <span className="flex-1">{title}</span>
          <span className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground font-mono">{id}</span>
            <SevBadge sev={sev} />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs space-y-3">
        {children}
        <div className={`flex items-start gap-1.5 pt-1 border-t border-muted/30 ${SEV_TEXT[sev]}`}>
          <span className="font-semibold shrink-0">Ação:</span>
          <span className="text-muted-foreground">{action}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="rounded border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/30">
            {headers.map((h, i) => (
              <th key={i} className={`p-2 text-muted-foreground ${i > 0 ? "text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b hover:bg-muted/20">
              {row.map((cell, j) => (
                <td key={j} className={`p-2 ${j > 0 ? "text-right" : ""}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SecurityAnalysis() {
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    eventsApi.securityStats().then(setStats).finally(() => setLoading(false));
  }, []);

  async function handleExport() {
    if (!stats) return;
    setExporting(true);
    try { exportSecurityPdf(stats); }
    finally { setExporting(false); }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-32 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const totalAuthFailures = stats.authByEndpoint.reduce((s, r) => s + parseInt(r.failures), 0);
  const totalCritical = stats.criticalByContext.reduce((s, r) => s + parseInt(r.count), 0);

  // Count active findings per severity
  const active = {
    critical: [
      stats.jwtInLogs.total > 0,
      stats.expiredCerts.length > 0,
      stats.bruteForce.length > 0,
      totalCritical > 0,
    ].filter(Boolean).length,
    high: [
      stats.dataProtectionUnencrypted > 0,
      stats.forwardedHeadersMismatch > 0,
      stats.swaggerEvidence > 0,
      stats.stackTraceEndpoints.length > 0,
      stats.efClientEval.localEval > 0,
    ].filter(Boolean).length,
    medium: [
      stats.hangfireFailures.length > 0,
      stats.anomalousUsernames.length > 0,
      stats.onlyEmptyGuidUsers.length > 0,
      stats.vehicleIpsExposed > 0,
      stats.slowQueries.count > 0,
    ].filter(Boolean).length,
    low: 0,
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || !stats} className="gap-2">
          <FileDown className="h-4 w-4" />
          {exporting ? "Gerando PDF…" : "Exportar PDF"}
        </Button>
      </div>
      {/* Summary bar */}
      <div className="rounded-lg border border-red-600/30 bg-red-600/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-red-400" />
          <p className="text-sm font-semibold text-red-300">Análise de Segurança — {Object.values(active).reduce((a, b) => a + b, 0)} findings ativos</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {(["critical", "high", "medium"] as Severity[]).map((s) => (
            <div key={s} className={`flex items-center gap-2 px-3 py-1.5 rounded ${SEV_BADGE[s]}`}>
              <span className="font-bold text-lg leading-none">{active[s]}</span>
              <span className="text-xs">{SEV_LABEL[s]}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 px-3 py-1.5 rounded border border-muted text-muted-foreground ml-auto text-xs">
            <span><Activity className="h-3.5 w-3.5 inline mr-1" />{totalAuthFailures} falhas de auth</span>
            <span><AlertTriangle className="h-3.5 w-3.5 inline mr-1" />{totalCritical} Critical</span>
          </div>
        </div>
      </div>

      {/* ───── CRÍTICO ───── */}

      {/* SEC-010: JWT em logs */}
      {stats.jwtInLogs.total > 0 && (
        <FindingCard
          id="SEC-010" sev="critical"
          title="Token JWT de API Key exposto em texto plano nos logs"
          icon={<Key className="h-4 w-4" />}
          action="Remover logging do token no FINANCE Collector. Revogar e rotacionar o token imediatamente. Nunca logar credenciais, tokens ou secrets."
        >
          <p className="text-muted-foreground">
            O serviço <code className="bg-muted px-1 rounded">finance</code> está registrando um token JWT de API Key (Serasa)
            em <strong className="text-foreground">{stats.jwtInLogs.total.toLocaleString("pt-BR")}</strong> eventos.
            O token tem <code className="bg-muted px-1 rounded">apiKey: true</code> e está completamente exposto no Seq
            — que não tem autenticação habilitada.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted/30 rounded p-2">
              <p className="text-muted-foreground">Ocorrências</p>
              <p className="text-xl font-bold text-red-300">{stats.jwtInLogs.total.toLocaleString("pt-BR")}</p>
            </div>
            <div className="bg-muted/30 rounded p-2">
              <p className="text-muted-foreground">Tokens únicos</p>
              <p className="text-xl font-bold text-red-300">{stats.jwtInLogs.uniqueTokens}</p>
            </div>
          </div>
          {stats.jwtInLogs.firstSeen && (
            <p className="text-muted-foreground">
              Primeiro: <strong className="text-foreground">{formatTimestamp(stats.jwtInLogs.firstSeen)}</strong>
              {" "}· Último: <strong className="text-foreground">{formatTimestamp(stats.jwtInLogs.lastSeen!)}</strong>
            </p>
          )}
        </FindingCard>
      )}

      {/* SEC-011: Certificado expirado */}
      {stats.expiredCerts.length > 0 && (
        <FindingCard
          id="SEC-011" sev="critical"
          title="Certificado SSL expirado há mais de 2 anos em uso em produção"
          icon={<Lock className="h-4 w-4" />}
          action="Renovar o certificado imediatamente. Verificar se o domínio auth-dev.ituran.dev está sendo usado inadvertidamente em produção — trocar para o certificado do ambiente de produção correto."
        >
          <p className="text-muted-foreground">
            O IdentityServer4 está emitindo warnings contínuos de certificado expirado.
            Um certificado de ambiente de <strong className="text-red-300">desenvolvimento</strong> está sendo
            usado em <strong className="text-red-300">produção</strong>.
          </p>
          {stats.expiredCerts.map((c, i) => (
            <div key={i} className="bg-muted/30 rounded p-3 space-y-1">
              <div className="flex justify-between items-start gap-2 flex-wrap">
                <code className="text-amber-300">{c.cert_name?.trim()}</code>
                <Badge variant="error">{parseInt(c.count).toLocaleString("pt-BR")} warnings</Badge>
              </div>
              <p className="text-red-400 font-semibold">Expirou em: {c.expired_on?.trim()}</p>
              <p className="text-muted-foreground text-xs">
                Primeiro detectado: {formatTimestamp(c.first_seen)} · Último: {formatTimestamp(c.last_seen)}
              </p>
            </div>
          ))}
        </FindingCard>
      )}

      {/* SEC-001: Brute force */}
      {stats.bruteForce.length > 0 && (
        <FindingCard
          id="SEC-001" sev="critical"
          title="Credential Stuffing / Força Bruta — múltiplas tentativas em < 5 minutos"
          icon={<Zap className="h-4 w-4" />}
          action="Implementar rate limiting (máx. 5 tentativas / 5 min por usuário). Implementar lockout temporário. Configurar alerta em tempo real para >= 3 falhas por usuário em 1 minuto."
        >
          <p className="text-muted-foreground">
            <strong className="text-foreground">{stats.bruteForce.length} usuário(s)</strong> com ≥ 3 tentativas em menos
            de 5 minutos. A frequência de alguns usuários é incompatível com ação humana — indica automação.
          </p>
          <MiniTable
            headers={["Usuário", "Tentativas", "Janela", "Freq.", "Último"]}
            rows={stats.bruteForce.map((r) => [
              <span className="font-mono text-amber-300">{r.username}</span>,
              <Badge variant="error">{r.attempts}</Badge>,
              <span className="text-muted-foreground">{r.window_minutes}min</span>,
              <span className={`font-bold ${parseFloat(r.rate_per_min) > 10 ? "text-red-400" : "text-orange-400"}`}>
                {r.rate_per_min}/min
              </span>,
              <span className="text-muted-foreground whitespace-nowrap">{formatTimestamp(r.last_seen)}</span>,
            ])}
          />
        </FindingCard>
      )}

      {/* SEC-002: Critical unhandled */}
      {totalCritical > 0 && (
        <FindingCard
          id="SEC-002" sev="critical"
          title={`Exceções não tratadas (Critical) — ${totalCritical} eventos`}
          icon={<AlertTriangle className="h-4 w-4" />}
          action="Investigar causa raiz de cada source context com Critical. Garantir middleware de erro global retornando RFC 7807 sem stack trace. Verificar se /connect/token retorna 500 em vez de 401/400."
        >
          <MiniTable
            headers={["Source Context", "Total", "Último"]}
            rows={stats.criticalByContext.map((r) => [
              <span className="font-mono text-muted-foreground">{r.source_context || "(sem contexto)"}</span>,
              <Badge variant="error">{r.count}</Badge>,
              <span className="text-muted-foreground whitespace-nowrap">{formatTimestamp(r.last_seen)}</span>,
            ])}
          />
        </FindingCard>
      )}

      {/* ───── ALTO ───── */}

      {/* SEC-012: DataProtection sem criptografia */}
      {stats.dataProtectionUnencrypted > 0 && (
        <FindingCard
          id="SEC-012" sev="high"
          title="ASP.NET Data Protection — chaves armazenadas sem criptografia"
          icon={<Lock className="h-4 w-4" />}
          action='Configurar XML encryptor no startup: services.AddDataProtection().ProtectKeysWithDpapi() ou .ProtectKeysWithCertificate(). Chaves de Data Protection não criptografadas permitem forjar cookies de sessão e tokens CSRF.'
        >
          <p className="text-muted-foreground">
            <strong className="text-foreground">{stats.dataProtectionUnencrypted}</strong> warning(s){" "}
            <code className="bg-muted px-1 rounded">No XML encryptor configured. Key may be persisted to storage in unencrypted form.</code>
          </p>
          <p className="text-muted-foreground">
            As chaves de Data Protection são usadas para criptografar cookies de autenticação, tokens anti-CSRF e
            dados protegidos. Sem criptografia em repouso, qualquer acesso ao storage compromete todas as sessões ativas.
          </p>
        </FindingCard>
      )}

      {/* SEC-013: ForwardedHeaders mismatch */}
      {stats.forwardedHeadersMismatch > 0 && (
        <FindingCard
          id="SEC-013" sev="high"
          title={`Proxy headers inconsistentes — risco de IP spoofing (${stats.forwardedHeadersMismatch.toLocaleString("pt-BR")} warnings)`}
          icon={<Activity className="h-4 w-4" />}
          action='Corrigir configuração do proxy reverso/nginx: garantir que X-Forwarded-For e X-Forwarded-Proto sempre têm o mesmo número de entradas. Usar ForwardedHeadersOptions.KnownProxies para restringir IPs confiáveis.'
        >
          <p className="text-muted-foreground">
            O middleware <code className="bg-muted px-1 rounded">ForwardedHeadersMiddleware</code> detecta
            {" "}<strong className="text-foreground">{stats.forwardedHeadersMismatch.toLocaleString("pt-BR")}</strong>{" "}
            requisições com contagem incompatível entre <code className="bg-muted px-1 rounded">X-Forwarded-For</code> e{" "}
            <code className="bg-muted px-1 rounded">X-Forwarded-Proto</code>.
          </p>
          <p className="text-muted-foreground">
            Isso indica que um atacante pode injetar valores extras no header <code className="bg-muted px-1 rounded">X-Forwarded-For</code>,
            fazendo a aplicação acreditar que a requisição vem de um IP diferente — contornando controles
            baseados em IP como rate limiting e whitelists.
          </p>
        </FindingCard>
      )}

      {/* SEC-003: Swagger em produção */}
      {stats.swaggerEvidence > 0 && (
        <FindingCard
          id="SEC-003" sev="high"
          title="Swagger / OpenAPI habilitado em produção (integra-prd)"
          icon={<Eye className="h-4 w-4" />}
          action='Restringir Swagger a ambiente de desenvolvimento: if (app.Environment.IsDevelopment()) { app.UseSwagger(); app.UseSwaggerUI(); }'
        >
          <p className="text-muted-foreground">
            Encontradas <strong className="text-foreground">{stats.swaggerEvidence}</strong> evidências do
            SwaggerMiddleware na cadeia de execução do ambiente <code className="bg-muted px-1 rounded">integra-prd</code>.
            O Swagger expõe o mapa completo da API — todos os endpoints, parâmetros, schemas e exemplos —
            facilitando significativamente o planejamento de ataques.
          </p>
        </FindingCard>
      )}

      {/* SEC-004: Stack traces */}
      {stats.stackTraceEndpoints.length > 0 && (
        <FindingCard
          id="SEC-004" sev="high"
          title="Stack traces internos expostos nos logs de produção"
          icon={<Code className="h-4 w-4" />}
          action="Adicionar middleware de erro global que retorna mensagem genérica ao cliente. Os stack traces devem ser apenas internos nos logs, nunca retornados em resposta HTTP."
        >
          <p className="text-muted-foreground">
            Endpoints com stack traces completos em logs (caminhos de código, nomes de métodos, números de linha).
            Se retornados ao cliente, violam OWASP A05:2021 (Security Misconfiguration).
          </p>
          <MiniTable
            headers={["Endpoint", "Eventos com stack trace"]}
            rows={stats.stackTraceEndpoints.map((r) => [
              <span className="font-mono">{r.request_path}</span>,
              <Badge variant="error">{r.count}</Badge>,
            ])}
          />
        </FindingCard>
      )}

      {/* SEC-014: EF client-side evaluation */}
      {stats.efClientEval.localEval > 0 && (
        <FindingCard
          id="SEC-014" sev="high"
          title={`LINQ avaliado no cliente — ${(stats.efClientEval.localEval + stats.efClientEval.noOrderBy).toLocaleString("pt-BR")} queries problemáticas`}
          icon={<Database className="h-4 w-4" />}
          action="Reescrever GroupBy e First() sem OrderBy para que sejam traduzíveis para SQL. Client-side evaluation carrega todo o dataset na memória do servidor antes de filtrar — risco de OOM e exposição de dados não filtrados."
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted/30 rounded p-2">
              <p className="text-muted-foreground">LINQ avaliado no cliente</p>
              <p className="text-xl font-bold text-orange-300">{stats.efClientEval.localEval.toLocaleString("pt-BR")}</p>
              <p className="text-muted-foreground mt-1">Carrega dados em memória em vez de filtrar no SQL</p>
            </div>
            <div className="bg-muted/30 rounded p-2">
              <p className="text-muted-foreground">First() sem OrderBy</p>
              <p className="text-xl font-bold text-orange-300">{stats.efClientEval.noOrderBy.toLocaleString("pt-BR")}</p>
              <p className="text-muted-foreground mt-1">Resultado não determinístico — pode retornar registro errado</p>
            </div>
          </div>
        </FindingCard>
      )}

      {/* ───── MÉDIO ───── */}

      {/* SEC-015: Hangfire */}
      {stats.hangfireFailures.length > 0 && (
        <FindingCard
          id="SEC-015" sev="medium"
          title="Jobs Hangfire falhando — alguns próximos do limite de retentativas"
          icon={<RefreshCw className="h-4 w-4" />}
          action="Verificar Hangfire Dashboard para identificar os jobs no dead queue. Investigar a exception de cada job. Jobs em retry 9/10 vão para dead queue na próxima falha e param definitivamente."
        >
          <MiniTable
            headers={["Mensagem do Job", "Ocorrências", "Último"]}
            rows={stats.hangfireFailures.map((r) => [
              <span className="text-muted-foreground">{r.message.slice(0, 80)}{r.message.length > 80 ? "…" : ""}</span>,
              <Badge variant="warning">{r.count}</Badge>,
              <span className="text-muted-foreground whitespace-nowrap">{formatTimestamp(r.last_seen)}</span>,
            ])}
          />
        </FindingCard>
      )}

      {/* SEC-005: Usernames anômalos */}
      {stats.anomalousUsernames.length > 0 && (
        <FindingCard
          id="SEC-005" sev="medium"
          title={`${stats.anomalousUsernames.length} username(s) em formato anômalo — inclui possível CNPJ`}
          icon={<Users className="h-4 w-4" />}
          action="Investigar se há bug no frontend passando CNPJ como username. Validar formato de entrada no IDP. Usernames sem @ são mais suscetíveis a ataques de dicionário."
        >
          <div className="flex flex-wrap gap-2">
            {stats.anomalousUsernames.map((u, i) => (
              <div key={i} className="flex items-center gap-1 bg-muted/40 border rounded px-2 py-1">
                <span className="font-mono text-amber-300">{u.username}</span>
                <Badge variant="error" className="text-xs">{u.attempts}x</Badge>
              </div>
            ))}
          </div>
        </FindingCard>
      )}

      {/* SEC-006: 100% GUID vazio */}
      {stats.onlyEmptyGuidUsers.length > 0 && (
        <FindingCard
          id="SEC-006" sev="medium"
          title={`${stats.onlyEmptyGuidUsers.length} usuário(s) com 100% de chamadas com GUID vazio`}
          icon={<Hash className="h-4 w-4" />}
          action="Investigar via lookup cd_pessoa quem são esses usuários. Verificar se são contas de teste, integradoras ou clientes com bug de cliente específico."
        >
          <MiniTable
            headers={["UserId", "Chamadas com GUID vazio"]}
            rows={stats.onlyEmptyGuidUsers.map((r) => [
              <span className="font-mono">#{r.user_id}</span>,
              <Badge variant="error">{r.empty_guid_calls}</Badge>,
            ])}
          />
        </FindingCard>
      )}

      {/* SEC-016: IPs de veículos */}
      {stats.vehicleIpsExposed > 0 && (
        <FindingCard
          id="SEC-016" sev="medium"
          title={`${stats.vehicleIpsExposed.toLocaleString("pt-BR")} IPs únicos de veículos (PocSag) expostos nos logs`}
          icon={<MapPin className="h-4 w-4" />}
          action="Mascarar IPs de rastreamento nos logs (últimos octetos). Revisar conformidade com LGPD art. 6 — dados de localização de veículos são dados pessoais sensíveis quando vinculados ao titular."
        >
          <p className="text-muted-foreground">
            Dados de localização de <strong className="text-foreground">{stats.vehicleIpsExposed.toLocaleString("pt-BR")}</strong>{" "}
            dispositivos de rastreamento (PocSag) aparecem em texto plano nos logs de Warning.
            Com o Seq sem autenticação, qualquer pessoa na rede interna pode ver esses dados — possível violação da LGPD.
          </p>
        </FindingCard>
      )}

      {/* SEC-017: Slow queries */}
      {stats.slowQueries.count > 0 && (
        <FindingCard
          id="SEC-017" sev="medium"
          title={`${stats.slowQueries.count} queries lentas (> 500ms) — máx. ${stats.slowQueries.maxMs}ms`}
          icon={<Cpu className="h-4 w-4" />}
          action="Analisar as queries mais lentas (> 1s) e adicionar índices adequados. Queries lentas podem ser exploradas para DoS por usuários autenticados com chamadas repetidas."
        >
          <p className="text-muted-foreground">
            Identificadas <strong className="text-foreground">{stats.slowQueries.count}</strong> execuções
            de queries acima de 500ms. A mais lenta levou{" "}
            <strong className="text-foreground">{stats.slowQueries.maxMs.toLocaleString("pt-BR")}ms</strong>{" "}
            ({(stats.slowQueries.maxMs / 1000).toFixed(1)}s). Queries lentas sem rate limiting são vetores de DoS.
          </p>
        </FindingCard>
      )}

      {/* Auth breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            Falhas de Autenticação por Endpoint
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-3 text-muted-foreground">Endpoint</th>
                  <th className="text-left p-3 text-muted-foreground">ClientId</th>
                  <th className="text-right p-3 text-muted-foreground">Falhas</th>
                  <th className="text-right p-3 text-muted-foreground">Usuários únicos</th>
                </tr>
              </thead>
              <tbody>
                {stats.authByEndpoint.map((r, i) => (
                  <tr key={i} className="border-b hover:bg-muted/20">
                    <td className="p-3 font-mono">{r.request_path || "—"}</td>
                    <td className="p-3 font-mono text-amber-300">{r.client_id || "—"}</td>
                    <td className="p-3 text-right"><Badge variant="error">{r.failures}</Badge></td>
                    <td className="p-3 text-right text-muted-foreground">{r.unique_users}</td>
                  </tr>
                ))}
                {!stats.authByEndpoint.length && (
                  <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Nenhuma falha de autenticação</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top error endpoints */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Top Endpoints por Volume de Erro</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-3 text-muted-foreground">Endpoint</th>
                  <th className="text-left p-3 text-muted-foreground">Nível</th>
                  <th className="text-right p-3 text-muted-foreground">Erros</th>
                </tr>
              </thead>
              <tbody>
                {stats.topErrorEndpoints.map((r, i) => (
                  <tr key={i} className="border-b hover:bg-muted/20">
                    <td className="p-3 font-mono">{r.request_path}</td>
                    <td className="p-3">
                      <Badge variant={r.level === "Critical" ? "error" : "warning"}>{r.level}</Badge>
                    </td>
                    <td className="p-3 text-right font-bold">{r.count}</td>
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
