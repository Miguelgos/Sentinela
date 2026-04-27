import { useState, useCallback } from "react";
import { reportApi, ThreatReport, CorrelatedThreat, RiskLevel } from "@/lib/api";
import { exportThreatReportPdf } from "@/lib/exportPdf";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, ShieldAlert, RefreshCw, CheckCircle2, XCircle, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";

const RISK_CONFIG: Record<RiskLevel, { label: string; bg: string; text: string; border: string }> = {
  CRITICAL: { label: "CRÍTICO",  bg: "bg-red-950",    text: "text-red-300",    border: "border-red-700" },
  HIGH:     { label: "ALTO",     bg: "bg-orange-950", text: "text-orange-300", border: "border-orange-700" },
  MEDIUM:   { label: "MÉDIO",    bg: "bg-yellow-950", text: "text-yellow-300", border: "border-yellow-700" },
  LOW:      { label: "BAIXO",    bg: "bg-green-950",  text: "text-green-300",  border: "border-green-700" },
  INFO:     { label: "INFO",     bg: "bg-blue-950",   text: "text-blue-300",   border: "border-blue-700" },
};

function riskCfg(level: RiskLevel) {
  return RISK_CONFIG[level] ?? RISK_CONFIG.INFO;
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const cfg = riskCfg(level);
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border", cfg.bg, cfg.text, cfg.border)}>
      {cfg.label}
    </span>
  );
}

function SourceBadge({ label, ok, metric }: { label: string; ok: boolean; metric: string }) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-md border text-sm",
      ok ? "bg-green-950/40 border-green-800 text-green-300" : "bg-red-950/40 border-red-800 text-red-300"
    )}>
      {ok
        ? <CheckCircle2 className="h-4 w-4 shrink-0" />
        : <XCircle className="h-4 w-4 shrink-0" />
      }
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground ml-auto text-xs">{metric}</span>
    </div>
  );
}

function FindingCard({ finding }: { finding: CorrelatedThreat }) {
  const cfg = riskCfg(finding.risk);
  return (
    <Card className={cn("border", cfg.border)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">{finding.title}</CardTitle>
          <RiskBadge level={finding.risk} />
        </div>
        <p className="text-xs text-muted-foreground">{finding.description}</p>
      </CardHeader>
      {finding.evidence.length > 0 && (
        <CardContent className="pt-0">
          <p className="text-xs font-medium text-muted-foreground mb-1">Evidências</p>
          <ul className="space-y-0.5">
            {finding.evidence.map((ev, i) => (
              <li key={i} className="text-xs font-mono bg-muted/40 px-2 py-0.5 rounded">{ev}</li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function NarrativeSection({ text }: { text: string }) {
  const lines = text.split("\n").filter(l => l.trim() !== "");
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        const isBullet  = trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("*") && !trimmed.startsWith("**");
        const isHeading = /^\*\*[^*]+\*\*/.test(trimmed) || /^#{1,3}\s/.test(trimmed);
        const cleaned   = trimmed
          .replace(/^\*\*(.+)\*\*$/, "$1")
          .replace(/^#{1,3}\s/, "")
          .replace(/\*\*(.+?)\*\*/g, "$1")
          .trim();

        if (isHeading) {
          return <p key={i} className="font-semibold text-foreground mt-3 first:mt-0">{cleaned}</p>;
        }
        if (isBullet) {
          return (
            <p key={i} className="flex gap-2 text-muted-foreground">
              <span className="shrink-0 text-primary">•</span>
              <span>{cleaned.replace(/^[•\-*]\s*/, "")}</span>
            </p>
          );
        }
        return <p key={i} className="text-muted-foreground">{cleaned}</p>;
      })}
    </div>
  );
}


export function ReportAnalysis() {
  const [data, setData]       = useState<ThreatReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const report = await reportApi.threatReport();
      setData(report);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  if (!data && !loading && !error) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24">
        <ShieldAlert className="h-16 w-16 text-muted-foreground" />
        <div className="text-center space-y-1">
          <h2 className="text-lg font-semibold">Relatório de Ameaças Cibernéticas</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Correlaciona dados de Seq, Datadog e GoCache WAF com análise narrativa gerada por IA.
          </p>
        </div>
        <Button onClick={generate} size="lg">
          <ShieldAlert className="h-4 w-4 mr-2" />
          Gerar Relatório
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Coletando dados e gerando análise…</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-md" />)}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 rounded-md" />)}
        </div>
        <Skeleton className="h-48 rounded-md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-destructive">
        <AlertTriangle className="h-10 w-10" />
        <p className="text-sm">{error}</p>
        <Button variant="outline" onClick={generate}>Tentar novamente</Button>
      </div>
    );
  }

  if (!data) return null;

  const cfg = riskCfg(data.riskLevel);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Gerado em {new Date(data.generatedAt).toLocaleString("pt-BR")}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportThreatReportPdf(data)}>
            <FileDown className="h-4 w-4 mr-1.5" />
            Exportar PDF
          </Button>
          <Button variant="outline" size="sm" onClick={generate}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Risk banner */}
      <div className={cn("rounded-lg border p-4", cfg.bg, cfg.border)}>
        <div className="flex items-center gap-3">
          <ShieldAlert className={cn("h-6 w-6", cfg.text)} />
          <div>
            <p className={cn("text-lg font-bold", cfg.text)}>Risco Geral: {cfg.label}</p>
            <p className="text-xs text-muted-foreground">
              {data.findings.length} ameaça(s) detectada(s) nas últimas 24 horas
            </p>
          </div>
        </div>
      </div>

      {/* Sources */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Fontes</p>
        <div className="grid grid-cols-3 gap-3">
          <SourceBadge
            label="Seq"
            ok={data.sources.seq.ok}
            metric={`${data.sources.seq.events.toLocaleString()} eventos`}
          />
          <SourceBadge
            label="Datadog"
            ok={data.sources.datadog.ok}
            metric={`${data.sources.datadog.alerts} alertas`}
          />
          <SourceBadge
            label="GoCache WAF"
            ok={data.sources.gocache.ok}
            metric={`${data.sources.gocache.blocked} bloqueios`}
          />
        </div>
      </div>

      <Separator />

      {/* Findings */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Ameaças Detectadas
        </p>
        {data.findings.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <CheckCircle2 className="h-5 w-5 text-green-400" />
            Nenhuma ameaça crítica identificada no período analisado.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.findings.map((f, i) => (
              <FindingCard key={i} finding={f} />
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* AI narrative */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Análise IA
          </p>
        </div>
        {data.narrativeError && (
          <div className="flex items-start gap-2 mb-3 rounded-md border border-yellow-700 bg-yellow-950/40 px-3 py-2 text-xs text-yellow-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{data.narrativeError}</span>
          </div>
        )}
        <Card>
          <CardContent className="pt-4">
            <NarrativeSection text={data.narrative} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
