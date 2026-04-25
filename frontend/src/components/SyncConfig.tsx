import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCw, Upload, Trash2, Database, CheckCircle, XCircle, Key, Clock, Zap, Info,
} from "lucide-react";
import { syncApi, eventsApi, autoSyncApi, AutoSyncStatus } from "@/lib/api";
import { formatTimestamp } from "@/lib/utils";
import { subHours, format } from "date-fns";

const PRESETS = [
  { label: "1h", hours: 1 },
  { label: "4h", hours: 4 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
  { label: "48h", hours: 48 },
  { label: "7d", hours: 168 },
];

function isoFromNow(hours: number): string {
  return subHours(new Date(), hours).toISOString();
}

export function SyncConfig({ onSynced }: { onSynced?: () => void }) {
  const [seqUrl, setSeqUrl] = useState("https://seq-prd.ituran.sp");
  const [signal, setSignal] = useState("");
  const [count, setCount] = useState("5000");
  const [apiKey, setApiKey] = useState("");
  const [preset, setPreset] = useState<number | null>(4); // default: últimas 4h
  const [startDate, setStartDate] = useState(() =>
    format(subHours(new Date(), 4), "yyyy-MM-dd'T'HH:mm")
  );
  const [endDate, setEndDate] = useState("");

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ imported: number; skipped: number; total: number; pages: number } | null>(null);
  const [syncError, setSyncError] = useState("");
  const [lastConfig, setLastConfig] = useState<{
    seq_url: string; signal: string; last_synced_at: string; last_count: number;
  } | null>(null);

  const [importJson, setImportJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);
  const [importError, setImportError] = useState("");

  const [generating, setGenerating] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [autoStatus, setAutoStatus] = useState<AutoSyncStatus | null>(null);
  const [autoToggling, setAutoToggling] = useState(false);

  useEffect(() => {
    syncApi.getConfig().then(setLastConfig).catch(() => {});
    autoSyncApi.status().then(setAutoStatus).catch(() => {});

    const iv = setInterval(() => {
      autoSyncApi.status().then(setAutoStatus).catch(() => {});
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  const toggleAutoSync = async () => {
    setAutoToggling(true);
    try {
      if (autoStatus?.running) {
        const res = await autoSyncApi.stop();
        setAutoStatus(res.status);
      } else {
        const res = await autoSyncApi.start({ seqUrl, signal, apiKey: apiKey || undefined });
        setAutoStatus(res.status);
      }
    } catch { /* silent */ } finally {
      setAutoToggling(false);
    }
  };

  const selectPreset = (hours: number) => {
    setPreset(hours);
    setStartDate(format(subHours(new Date(), hours), "yyyy-MM-dd'T'HH:mm"));
    setEndDate("");
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncError("");
    setSyncResult(null);
    try {
      const fromDate = preset !== null ? isoFromNow(preset) : (startDate ? new Date(startDate).toISOString() : undefined);
      const toDate = endDate ? new Date(endDate).toISOString() : undefined;

      const res = await syncApi.sync({
        seqUrl,
        signal,
        count: parseInt(count),
        apiKey: apiKey || undefined,
        startDate: fromDate,
        endDate: toDate,
      });
      setSyncResult(res);
      onSynced?.();
      syncApi.getConfig().then(setLastConfig).catch(() => {});
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setSyncError(e.response?.data?.error || e.message || "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setImportError("");
    setImportResult(null);
    try {
      let events: unknown[];
      const parsed = JSON.parse(importJson);
      if (Array.isArray(parsed)) {
        events = parsed;
      } else if (parsed.Events && Array.isArray(parsed.Events)) {
        events = parsed.Events;
      } else {
        events = [parsed];
      }
      const res = await eventsApi.import(events);
      setImportResult(res);
      setImportJson("");
      onSynced?.();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setImportError(e.response?.data?.error || e.message || "JSON inválido ou erro na importação");
    } finally {
      setImporting(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await eventsApi.generateSample();
      alert(res.message);
      onSynced?.();
    } catch {
      alert("Erro ao gerar dados de exemplo");
    } finally {
      setGenerating(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("Tem certeza que deseja remover todos os eventos?")) return;
    setClearing(true);
    try {
      await eventsApi.clear();
      setSyncResult(null);
      onSynced?.();
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* Sync */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Sincronizar com Seq
          </CardTitle>
          <CardDescription>
            Importa eventos do Seq para análise local.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {lastConfig && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground flex flex-wrap gap-4">
              <span>Último sync: <strong className="text-foreground">{formatTimestamp(lastConfig.last_synced_at)}</strong></span>
              <span>Importados: <strong className="text-foreground">{lastConfig.last_count}</strong></span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>URL do Seq</Label>
              <Input value={seqUrl} onChange={(e) => setSeqUrl(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>
                Signal{" "}
                <span className="text-muted-foreground text-xs font-normal">
                  (vazio = todos os níveis)
                </span>
              </Label>
              <div className="flex gap-2">
                <Input
                  value={signal}
                  onChange={(e) => setSignal(e.target.value)}
                  placeholder="Deixe vazio para todos os eventos"
                  className="flex-1"
                />
                {signal && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs shrink-0"
                    onClick={() => setSignal("")}
                  >
                    Limpar
                  </Button>
                )}
              </div>
              {!signal && (
                <p className="text-xs text-amber-400">
                  Sem signal: busca <strong>todos</strong> os níveis (Verbose, Debug, Info, Warning, Error, Critical).
                  Volume muito maior — considere reduzir o período.
                </p>
              )}
              {signal && (
                <p className="text-xs text-muted-foreground">
                  Filtrando pelo signal <code className="bg-muted px-1 rounded">{signal}</code>.
                  Use <code className="bg-muted px-1 rounded">signal-m33301</code> para apenas Error/Critical.
                </p>
              )}
            </div>
          </div>

          {/* Período */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Período
            </Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p.hours}
                  size="sm"
                  variant={preset === p.hours ? "default" : "outline"}
                  onClick={() => selectPreset(p.hours)}
                  className="h-8 px-3 text-xs"
                >
                  Últimas {p.label}
                </Button>
              ))}
              <Button
                size="sm"
                variant={preset === null ? "default" : "outline"}
                onClick={() => setPreset(null)}
                className="h-8 px-3 text-xs"
              >
                Personalizado
              </Button>
            </div>

            {preset === null && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">De</Label>
                  <Input
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Até (opcional)</Label>
                  <Input
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>
            )}

            {preset !== null && (
              <p className="text-xs text-muted-foreground">
                De <strong className="text-foreground">{format(subHours(new Date(), preset), "dd/MM/yyyy HH:mm")}</strong> até agora
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>
                API Key{" "}
                <span className="text-muted-foreground text-xs font-normal">(opcional)</span>
              </Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="pl-8"
                  placeholder="Deixe em branco se não exige auth"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Limite máximo de eventos</Label>
              <Input
                type="number"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                min={1}
                max={50000}
              />
            </div>
          </div>

          {syncError && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3">
              <XCircle className="h-4 w-4 shrink-0" />
              {syncError}
            </div>
          )}
          {syncResult && (
            <div className="flex items-start gap-2 text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded p-3">
              <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p><strong>{syncResult.imported}</strong> importados · <strong>{syncResult.skipped}</strong> já existiam</p>
                <p className="text-xs text-green-500/70 mt-0.5">
                  {syncResult.total} eventos recebidos em {syncResult.pages} {syncResult.pages === 1 ? "página" : "páginas"}
                </p>
              </div>
            </div>
          )}

          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3 text-xs text-yellow-300 flex gap-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span>O Seq tem retenção limitada — eventos antigos são descartados conforme novos chegam.</span>
              <ul className="list-disc list-inside space-y-0.5 text-yellow-300/80">
                <li>Sem signal: todos os níveis, volume muito maior, retenção ainda mais curta</li>
                <li><code className="bg-yellow-500/10 px-1 rounded">signal-m33301</code>: apenas Error/Critical, buffer menor mas mais focado</li>
                <li>Use <strong className="text-yellow-300">Sync automático</strong> para capturar continuamente antes de perder eventos</li>
              </ul>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button onClick={handleSync} disabled={syncing || !seqUrl} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizando…" : "Sincronizar agora"}
            </Button>

            <Button
              onClick={toggleAutoSync}
              disabled={autoToggling}
              variant={autoStatus?.running ? "destructive" : "secondary"}
              className="gap-2"
            >
              <Zap className={`h-4 w-4 ${autoStatus?.running ? "animate-pulse" : ""}`} />
              {autoStatus?.running
                ? `Parar auto-sync (${autoStatus.runs} execuções)`
                : "Sync automático (1 min)"}
            </Button>
          </div>

          {autoStatus?.running && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-blue-300 space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <Zap className="h-3.5 w-3.5 animate-pulse" />
                Auto-sync ativo — a cada {autoStatus.intervalMs / 1000}s
              </div>
              <div className="flex flex-wrap gap-4 text-blue-300/80">
                <span>Execuções: <strong className="text-blue-200">{autoStatus.runs}</strong></span>
                <span>Importados total: <strong className="text-blue-200">{autoStatus.totalImported}</strong></span>
                <span>Última exec: <strong className="text-blue-200">{autoStatus.lastRun ? formatTimestamp(autoStatus.lastRun) : "—"}</strong></span>
                {autoStatus.lastTotal > 0 && (
                  <span>Última página: <strong className="text-blue-200">{autoStatus.lastImported} novos de {autoStatus.lastTotal}</strong></span>
                )}
              </div>
              {autoStatus.error && (
                <div className="text-red-400 mt-1">Erro: {autoStatus.error}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import JSON */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Importar JSON manualmente
          </CardTitle>
          <CardDescription>
            Cole o JSON exportado do Seq (formato <code>{"{ Events: [...] }"}</code> ou array).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            placeholder={'[{"@t":"2026-04-25T00:35:08Z","@mt":"...","@l":"Error",...}]'}
            className="font-mono text-xs min-h-[140px]"
          />
          {importError && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3">
              <XCircle className="h-4 w-4 shrink-0" />
              {importError}
            </div>
          )}
          {importResult && (
            <div className="flex items-center gap-2 text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded p-3">
              <CheckCircle className="h-4 w-4 shrink-0" />
              {importResult.imported} importados, {importResult.skipped} ignorados
            </div>
          )}
          <Button onClick={handleImport} disabled={importing || !importJson.trim()} variant="outline" className="gap-2">
            <Upload className={`h-4 w-4 ${importing ? "animate-pulse" : ""}`} />
            {importing ? "Importando…" : "Importar"}
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex gap-3 flex-wrap">
        <Button onClick={handleGenerate} disabled={generating} variant="secondary" className="gap-2">
          <Database className="h-4 w-4" />
          {generating ? "Gerando…" : "Gerar eventos de exemplo"}
        </Button>
        <Button onClick={handleClear} disabled={clearing} variant="destructive" className="gap-2">
          <Trash2 className="h-4 w-4" />
          {clearing ? "Removendo…" : "Limpar todos os eventos"}
        </Button>
      </div>
    </div>
  );
}
