// Davis-style anomaly detection — auto-adaptive thresholds (P99 + IQR) com
// gatilho 3-de-5 minutos sobre janela de 10 dias. Veja docs/anomaly-detection-plan.md.

import type { StoredEvent } from "./accumulators/seqAccumulator";
import type { BucketStore } from "./timeseries/bucketStore";
import type { EventStore } from "./timeseries/eventStore";
import { areRelated, rootCauseService } from "./topology";

// Contexto passado para cada detector. bucketStore alimenta as séries de 10d;
// eventStore alimenta detectores que precisam do texto do evento (newMessage);
// historicalClusters mantém set persistente de clusters de mensagem vistos
// fora da janela de 1h (substitui o set efêmero do detector antigo).
export interface DetectorContext {
  bucketStore: BucketStore;
  eventStore: EventStore<StoredEvent>;
  historicalClusters: Set<string>;
  nowMin: number;
  source: string; // ex: "seq" — qual sub-namespace do bucketStore consultar
}

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM";
export type DetectorId =
  | "ERROR_RATE_SERVICE"
  | "ERROR_RATE_ENDPOINT"
  | "AUTH_BURST"
  | "NEW_MESSAGE"
  | "OFF_HOURS"
  | "WAF_BURST"
  | "NEW_ATTACK_ORIGIN"
  | "AUDIT_OFF_HOURS"
  | "NEW_AUDIT_USER"
  | "EXTERNAL_IP_AUDIT_SPIKE"
  | "POD_RESTART_SPIKE"
  | "INFRA_OFF_HOURS";

export interface TimeSeries {
  dimension: string;
  buckets: Map<number, number>;
}

export interface Baseline {
  dimension: string;
  p99: number;
  iqr: number;
  sampleCount: number;
}

export interface AnomalyEvent {
  detector: DetectorId;
  dimension: string;
  metric: number;
  baseline: number;
  threshold: number;
  violationsInWindow: number;
  windowSize: number;
  severity: Severity;
  detectedAt: string;
  evidence: string[];
}

export interface AnomalyProblem {
  id: string;
  rootDimension: string;
  severity: Severity;
  anomalies: AnomalyEvent[];
  narrative?: string;
}

export const MS_PER_MINUTE = 60_000;
export const REFERENCE_WINDOW_DAYS = 10;
export const REFERENCE_WINDOW_MIN = REFERENCE_WINDOW_DAYS * 24 * 60;
const MIN_SAMPLES_FOR_BASELINE = 3 * 24 * 60; // 3 dias × 1440 min

const DEFAULT_N = 3;
const DEFAULT_WINDOW_MIN = 5;
const DEFAULT_VIOLATIONS = 3;

function minuteBucket(timestamp: string): number {
  return Math.floor(new Date(timestamp).getTime() / MS_PER_MINUTE);
}

// Bucketiza eventos por minuto, agrupados por dimensão. Cada evento que retornar
// null no extractor é descartado (ex: evento sem service definido).
export function buildTimeSeries(
  events: StoredEvent[],
  extractor: (e: StoredEvent) => string | null,
): Map<string, TimeSeries> {
  const result = new Map<string, TimeSeries>();
  for (const ev of events) {
    const dim = extractor(ev);
    if (!dim) continue;
    const bucket = minuteBucket(ev.timestamp);
    let series = result.get(dim);
    if (!series) {
      series = { dimension: dim, buckets: new Map() };
      result.set(dim, series);
    }
    series.buckets.set(bucket, (series.buckets.get(bucket) ?? 0) + 1);
  }
  return result;
}

// Percentil interpolado (método linear). values DEVE estar ordenado ascendente.
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const frac = idx - lo;
  return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac;
}

// Holdout: minutos próximos do nowMin são excluídos do baseline para que um
// burst em andamento não contamine seu próprio threshold. Equivale ao "training
// vs detection window" do Davis. 5 min default = mesma janela do gatilho 3-de-5.
const BASELINE_HOLDOUT_MIN = 5;

// Computa P99 + IQR (P75 - P25) sobre os valores por minuto da série, considerando
// apenas a janela de referência [refWindowEndMin - REFERENCE_WINDOW_MIN, refWindowEndMin - holdout).
// Os últimos `holdout` minutos ficam fora da baseline.
export function computeBaseline(
  series: TimeSeries,
  refWindowEndMin: number,
  holdout: number = BASELINE_HOLDOUT_MIN,
): Baseline {
  const start = refWindowEndMin - REFERENCE_WINDOW_MIN;
  const end = refWindowEndMin - holdout;
  const values: number[] = [];
  // Inclui zeros para minutos sem evento dentro da janela — caso contrário
  // P99 fica enviesado para cima quando a série é esparsa.
  for (let m = start + 1; m < end; m++) {
    values.push(series.buckets.get(m) ?? 0);
  }
  values.sort((a, b) => a - b);
  return {
    dimension: series.dimension,
    p99: percentile(values, 0.99),
    iqr: percentile(values, 0.75) - percentile(values, 0.25),
    sampleCount: values.length,
  };
}

export function thresholdFor(baseline: Baseline, n: number = DEFAULT_N): number {
  // Quando IQR é 0 (série quase constante), usa P99 como piso mas exige pelo
  // menos baseline+1 para disparar — evita threshold = baseline causar trigger
  // em qualquer minuto com 1 evento a mais.
  const fluctuation = baseline.iqr > 0 ? baseline.iqr : 1;
  return baseline.p99 + n * fluctuation;
}

// Slot sazonal: hora-do-dia × dia-da-semana = 168 slots (24*7).
// Usado para detectar "normal pra hora atual" (madrugada de segunda é diferente
// de tarde de quarta).
export function seasonalSlot(minuteEpoch: number): number {
  const d = new Date(minuteEpoch * MS_PER_MINUTE);
  return d.getUTCDay() * 24 + d.getUTCHours();
}

export interface SeasonalBaseline {
  dimension: string;
  slots: Map<number, { p99: number; iqr: number; sampleCount: number }>;
}

// Computa baseline P99+IQR separado por slot hora-do-dia × dia-da-semana.
// Cada slot tem aproximadamente 60 minutos × N semanas (1 com janela 7d).
// Detector silencia slots com cobertura insuficiente (<30 min de histórico).
const MIN_SAMPLES_PER_SLOT = 30;

export function computeSeasonalBaseline(
  series: TimeSeries,
  refWindowEndMin: number,
  holdout: number = BASELINE_HOLDOUT_MIN,
): SeasonalBaseline {
  const start = refWindowEndMin - REFERENCE_WINDOW_MIN;
  const end = refWindowEndMin - holdout;
  const bySlot = new Map<number, number[]>();
  for (let m = start + 1; m < end; m++) {
    const slot = seasonalSlot(m);
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot)!.push(series.buckets.get(m) ?? 0);
  }
  const slots = new Map<number, { p99: number; iqr: number; sampleCount: number }>();
  for (const [slot, values] of bySlot) {
    values.sort((a, b) => a - b);
    slots.set(slot, {
      p99: percentile(values, 0.99),
      iqr: percentile(values, 0.75) - percentile(values, 0.25),
      sampleCount: values.length,
    });
  }
  return { dimension: series.dimension, slots };
}

// Detecta anomalia usando baseline sazonal: pega o slot do nowMin, calcula
// threshold do slot, aplica regra 3-de-5 minutos como detectAnomalies normal.
export function detectSeasonalAnomalies(
  series: TimeSeries,
  baseline: SeasonalBaseline,
  nowMin: number,
  opts: DetectOptions,
): AnomalyEvent[] {
  const n = opts.n ?? DEFAULT_N;
  const windowSize = opts.windowMin ?? DEFAULT_WINDOW_MIN;
  const minViolations = opts.minViolations ?? DEFAULT_VIOLATIONS;

  const slot = seasonalSlot(nowMin);
  const slotBaseline = baseline.slots.get(slot);
  if (!slotBaseline || slotBaseline.sampleCount < MIN_SAMPLES_PER_SLOT) return [];

  const fluctuation = slotBaseline.iqr > 0 ? slotBaseline.iqr : 1;
  const threshold = slotBaseline.p99 + n * fluctuation;

  let violations = 0;
  let peak = 0;
  let peakMin = nowMin;

  for (let m = nowMin - windowSize + 1; m <= nowMin; m++) {
    const value = series.buckets.get(m) ?? 0;
    if (value > threshold) {
      violations++;
      if (value > peak) {
        peak = value;
        peakMin = m;
      }
    }
  }

  if (violations < minViolations) return [];

  const ratio = (peak - slotBaseline.p99) / fluctuation;
  const severity: Severity = ratio >= 6 ? "CRITICAL" : ratio >= 4 ? "HIGH" : "MEDIUM";

  return [{
    detector: opts.detector,
    dimension: series.dimension,
    metric: peak,
    baseline: slotBaseline.p99,
    threshold,
    violationsInWindow: violations,
    windowSize,
    severity,
    detectedAt: new Date(peakMin * MS_PER_MINUTE).toISOString(),
    evidence: [
      `Pico observado: ${peak} eventos/min`,
      `Baseline sazonal (slot ${slot}, P99 + ${n}·IQR): ${threshold.toFixed(1)} eventos/min`,
      `Violações: ${violations}/${windowSize} minutos`,
    ],
  }];
}

function severityFor(metric: number, baseline: Baseline): Severity {
  const fluctuation = baseline.iqr > 0 ? baseline.iqr : 1;
  const ratio = (metric - baseline.p99) / fluctuation;
  if (ratio >= 6) return "CRITICAL";
  if (ratio >= 4) return "HIGH";
  return "MEDIUM";
}

interface DetectOptions {
  n?: number;
  windowMin?: number;
  minViolations?: number;
  detector: DetectorId;
}

// Detecta anomalias na série dada uma baseline. Aplica regra 3-de-5 minutos:
// percorre os últimos `windowMin` minutos do `nowMin` e dispara anomalia se
// ≥ minViolations buckets violarem o threshold. Retorna no máximo 1 anomalia
// por dimensão (a mais recente).
export function detectAnomalies(
  series: TimeSeries,
  baseline: Baseline,
  nowMin: number,
  opts: DetectOptions,
): AnomalyEvent[] {
  const n = opts.n ?? DEFAULT_N;
  const windowSize = opts.windowMin ?? DEFAULT_WINDOW_MIN;
  const minViolations = opts.minViolations ?? DEFAULT_VIOLATIONS;

  if (baseline.sampleCount < MIN_SAMPLES_FOR_BASELINE) return [];

  const threshold = thresholdFor(baseline, n);
  let violations = 0;
  let peak = 0;
  let peakMin = nowMin;

  for (let m = nowMin - windowSize + 1; m <= nowMin; m++) {
    const value = series.buckets.get(m) ?? 0;
    if (value > threshold) {
      violations++;
      if (value > peak) {
        peak = value;
        peakMin = m;
      }
    }
  }

  if (violations < minViolations) return [];

  return [{
    detector: opts.detector,
    dimension: series.dimension,
    metric: peak,
    baseline: baseline.p99,
    threshold,
    violationsInWindow: violations,
    windowSize,
    severity: severityFor(peak, baseline),
    detectedAt: new Date(peakMin * MS_PER_MINUTE).toISOString(),
    evidence: [
      `Pico observado: ${peak} eventos/min`,
      `Baseline (P99 + ${n}·IQR): ${threshold.toFixed(1)} eventos/min`,
      `Violações: ${violations}/${windowSize} minutos`,
    ],
  }];
}

const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1 };

function maxSeverity(items: { severity: Severity }[]): Severity {
  return items.reduce<Severity>(
    (max, x) => (SEVERITY_ORDER[x.severity] > SEVERITY_ORDER[max] ? x.severity : max),
    "MEDIUM",
  );
}

function serviceFromDimension(dim: string): string | null {
  const m = dim.match(/^service:(.+)$/);
  return m ? m[1] : null;
}

// Agrupa anomalias em problemas (3 estratégias de dedup, espelham Davis):
// 1. Source: mesmo (detector, dimension)
// 2. Time: detectadas dentro de ±2 min
// 3. Topology: services com relação no grafo (Fase 3) — root cause = mais upstream
export function correlateProblems(anomalies: AnomalyEvent[]): AnomalyProblem[] {
  if (anomalies.length === 0) return [];
  const problems: AnomalyProblem[] = [];
  const used = new Set<number>();
  for (let i = 0; i < anomalies.length; i++) {
    if (used.has(i)) continue;
    const seed = anomalies[i];
    const group = [seed];
    used.add(i);
    const seedService = serviceFromDimension(seed.dimension);
    for (let j = i + 1; j < anomalies.length; j++) {
      if (used.has(j)) continue;
      const cand = anomalies[j];
      const sameKey = cand.detector === seed.detector && cand.dimension === seed.dimension;
      const closeInTime =
        Math.abs(new Date(cand.detectedAt).getTime() - new Date(seed.detectedAt).getTime())
        <= 2 * MS_PER_MINUTE;
      const candService = serviceFromDimension(cand.dimension);
      const topologyRelated =
        seedService !== null && candService !== null && areRelated(seedService, candService);
      if (sameKey || closeInTime || topologyRelated) {
        group.push(cand);
        used.add(j);
      }
    }
    // Causa raiz: se houver múltiplos services no grupo, escolhe o mais upstream.
    const services = group.map(g => serviceFromDimension(g.dimension)).filter((s): s is string => s !== null);
    const rootService = rootCauseService([...new Set(services)]);
    const rootDimension = rootService ? `service:${rootService}` : seed.dimension;
    problems.push({
      id: `${seed.detector}:${rootDimension}:${seed.detectedAt}`,
      rootDimension,
      severity: maxSeverity(group),
      anomalies: group,
    });
  }
  return problems.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
}

// ── Detectors ─────────────────────────────────────────────────────────────────

// Endpoints com pouco tráfego histórico geram falsos positivos (P99 = 0, qualquer
// minuto com 1 evento dispara). Filtra dimensões com menos de 50 eventos no
// histórico — equivale a "endpoint visto pelo menos algumas vezes por dia".
const ENDPOINT_MIN_HISTORICAL_EVENTS = 50;

function totalEventsInWindow(series: TimeSeries, refWindowEndMin: number): number {
  const start = refWindowEndMin - REFERENCE_WINDOW_MIN;
  let total = 0;
  for (const [m, count] of series.buckets) {
    if (m >= start && m < refWindowEndMin) total += count;
  }
  return total;
}

// Helper: itera dimensões filtrando por prefixo, normaliza chave (remove prefix)
// e roda detectAnomalies. Agora todos os detectores baseados em bucketStore
// usam essa estrutura.
function detectByPrefix(
  ctx: DetectorContext,
  prefix: string,
  reportPrefix: string,
  detectorId: DetectorId,
  opts: { minHistorical?: number } = {},
): AnomalyEvent[] {
  const out: AnomalyEvent[] = [];
  for (const dim of ctx.bucketStore.getDimensions(ctx.source)) {
    if (!dim.startsWith(prefix)) continue;
    const series = ctx.bucketStore.getSeries(ctx.source, dim, ctx.nowMin);
    // Renomeia para apresentação externa (ex: "error_service:X" → "service:X")
    const reportDim = reportPrefix + dim.slice(prefix.length);
    const renamed: TimeSeries = { dimension: reportDim, buckets: series.buckets };
    if (opts.minHistorical && totalEventsInWindow(renamed, ctx.nowMin) < opts.minHistorical) continue;
    const baseline = computeBaseline(renamed, ctx.nowMin);
    out.push(...detectAnomalies(renamed, baseline, ctx.nowMin, { detector: detectorId }));
  }
  return out;
}

export const detectErrorRatePerService = (ctx: DetectorContext): AnomalyEvent[] =>
  detectByPrefix(ctx, "error_service:", "service:", "ERROR_RATE_SERVICE");

export const detectErrorRatePerEndpoint = (ctx: DetectorContext): AnomalyEvent[] =>
  detectByPrefix(ctx, "error_endpoint:", "endpoint:", "ERROR_RATE_ENDPOINT", {
    minHistorical: ENDPOINT_MIN_HISTORICAL_EVENTS,
  });

export const detectAuthBurst = (ctx: DetectorContext): AnomalyEvent[] => {
  const series = ctx.bucketStore.getSeries(ctx.source, "auth_failure", ctx.nowMin);
  if (series.buckets.size === 0) return [];
  // Renomeia dimensão para o nome histórico da UI
  const renamed: TimeSeries = { dimension: "auth_failures", buckets: series.buckets };
  const baseline = computeBaseline(renamed, ctx.nowMin);
  return detectAnomalies(renamed, baseline, ctx.nowMin, { detector: "AUTH_BURST" });
};

const NEW_MESSAGE_LOOKBACK_MIN = 60;
const MESSAGE_PREFIX_LEN = 80;

export function clusterKey(message: string | null | undefined): string | null {
  if (!message) return null;
  return message.slice(0, MESSAGE_PREFIX_LEN).replace(/\d+/g, "#").trim();
}

const ERROR_LEVELS = new Set(["Error", "Critical", "Fatal"]);

// Lê últimas LOOKBACK_MIN de eventos brutos do eventStore, agrupa por cluster,
// dispara se cluster não está em historicalClusters (set persistente).
export const detectNewMessage = (ctx: DetectorContext): AnomalyEvent[] => {
  const recentEvents = ctx.eventStore.list(ctx.source, ctx.nowMin - NEW_MESSAGE_LOOKBACK_MIN);
  const recent = new Map<string, { count: number; firstSeen: string }>();

  for (const e of recentEvents) {
    if (!ERROR_LEVELS.has(e.level)) continue;
    const key = clusterKey(e.message);
    if (!key) continue;
    const cur = recent.get(key);
    if (!cur) recent.set(key, { count: 1, firstSeen: e.timestamp });
    else cur.count++;
  }

  const out: AnomalyEvent[] = [];
  for (const [key, { count, firstSeen }] of recent) {
    if (ctx.historicalClusters.has(key)) continue;
    if (count < 3) continue; // exige reincidência

    out.push({
      detector: "NEW_MESSAGE",
      dimension: `message:${key.slice(0, 40)}`,
      metric: count,
      baseline: 0,
      threshold: 0,
      violationsInWindow: count,
      windowSize: NEW_MESSAGE_LOOKBACK_MIN,
      severity: count >= 50 ? "HIGH" : count >= 20 ? "MEDIUM" : "MEDIUM",
      detectedAt: firstSeen,
      evidence: [
        `Mensagem inédita nos últimos ${REFERENCE_WINDOW_DAYS}d`,
        `${count} ocorrências na última hora`,
        `Padrão: "${key.slice(0, 80)}"`,
      ],
    });
  }
  return out;
};

const DETECTOR_LABEL: Record<DetectorId, string> = {
  ERROR_RATE_SERVICE:  "Pico de erros por serviço",
  ERROR_RATE_ENDPOINT: "Pico de erros por endpoint",
  AUTH_BURST:          "Burst de falhas de autenticação",
  NEW_MESSAGE:         "Mensagem inédita",
  OFF_HOURS:           "Atividade off-hours",
  WAF_BURST:           "Pico de bloqueios WAF",
  NEW_ATTACK_ORIGIN:   "Origem de ataque inédita",
  AUDIT_OFF_HOURS:     "Auditoria off-hours",
  NEW_AUDIT_USER:      "Usuário de auditoria inédito",
  EXTERNAL_IP_AUDIT_SPIKE: "Pico de IP externo em auditoria",
  POD_RESTART_SPIKE:   "Spike de restarts em deployment",
  INFRA_OFF_HOURS:     "Atividade infra off-hours",
};

export function buildAnomalyPrompt(problem: AnomalyProblem): string {
  const head = problem.anomalies[0];
  const detectorName = DETECTOR_LABEL[head.detector] ?? head.detector;
  const detectedAt = new Date(head.detectedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const evidenceLines = problem.anomalies
    .flatMap(a => a.evidence.map(ev => `  - [${a.dimension}] ${ev}`))
    .slice(0, 10)
    .join("\n");

  return `Você é um analista de segurança/observabilidade sênior. Uma anomalia foi detectada no sistema integra-prd da Ituran via análise estatística (Davis-style: P99 + IQR sobre baseline de 7 dias, gatilho 3-de-5 minutos).

DETECTOR: ${detectorName}
DIMENSÃO RAIZ: ${problem.rootDimension}
SEVERIDADE: ${problem.severity}
DETECTADO EM: ${detectedAt}
ANOMALIAS CORRELACIONADAS: ${problem.anomalies.length}

EVIDÊNCIAS:
${evidenceLines}

Em até 80 palavras, em português, escreva uma análise objetiva contendo:
1. O que isso provavelmente significa (regressão, ataque, bug, incidente, etc.)
2. Uma ação concreta sugerida (ex: verificar deploy recente, checar logs do service X, etc.)

Seja direto. Sem introduções. Sem repetir as métricas — o leitor já viu.`;
}

export interface AnomalyTimeline {
  dimension: string;
  detector: DetectorId;
  baseline: number;
  threshold: number;
  points: { minute: number; metric: number }[];
}

const TIMELINE_WINDOW_MIN = 60;

// Mapeia detectorId → (prefix bucketStore, prefix de apresentação) pra reconstruir
// timeline a partir do bucketStore.
function dimMappingForTimeline(
  detectorId: DetectorId,
  reportDimension: string,
): { bucketDim: string; reportDim: string } | null {
  switch (detectorId) {
    case "ERROR_RATE_SERVICE":
      // reportDim = "service:salesbo" → bucketDim = "error_service:salesbo"
      return { bucketDim: reportDimension.replace(/^service:/, "error_service:"), reportDim: reportDimension };
    case "ERROR_RATE_ENDPOINT":
      return { bucketDim: reportDimension.replace(/^endpoint:/, "error_endpoint:"), reportDim: reportDimension };
    case "AUTH_BURST":
      return { bucketDim: "auth_failure", reportDim: "auth_failures" };
    case "OFF_HOURS":
      return { bucketDim: reportDimension, reportDim: reportDimension };
    default:
      return null;
  }
}

function timelineFor(
  detectorId: DetectorId,
  reportDimension: string,
  ctx: DetectorContext,
): AnomalyTimeline | null {
  const mapping = dimMappingForTimeline(detectorId, reportDimension);
  if (!mapping) return null;
  const series = ctx.bucketStore.getSeries(ctx.source, mapping.bucketDim, ctx.nowMin);
  if (series.buckets.size === 0) return null;

  const baseline = computeBaseline({ dimension: mapping.reportDim, buckets: series.buckets }, ctx.nowMin);
  const threshold = thresholdFor(baseline);
  const points: AnomalyTimeline["points"] = [];
  for (let m = ctx.nowMin - TIMELINE_WINDOW_MIN + 1; m <= ctx.nowMin; m++) {
    points.push({ minute: m, metric: series.buckets.get(m) ?? 0 });
  }

  return {
    dimension: mapping.reportDim,
    detector: detectorId,
    baseline: baseline.p99,
    threshold,
    points,
  };
}

export function buildTimelinesForProblems(
  problems: AnomalyProblem[],
  ctx: DetectorContext,
  limit: number = 3,
): AnomalyTimeline[] {
  const out: AnomalyTimeline[] = [];
  const seen = new Set<string>();
  for (const p of problems.slice(0, limit)) {
    const head = p.anomalies[0];
    const key = `${head.detector}:${head.dimension}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tl = timelineFor(head.detector, head.dimension, ctx);
    if (tl) out.push(tl);
  }
  return out;
}

export type Detector = (ctx: DetectorContext) => AnomalyEvent[];

// Off-hours: 0h-6h UTC (~ 21h-3h horário Brasil). Volume nesse slot que exceda
// a baseline do próprio slot é fortemente suspeito (deploy às 3h, scanner
// noturno, batch process problemático).
const OFF_HOURS_START_UTC = 0;
const OFF_HOURS_END_UTC = 6;

export const detectOffHoursVolume = (ctx: DetectorContext): AnomalyEvent[] => {
  const hour = new Date(ctx.nowMin * MS_PER_MINUTE).getUTCHours();
  if (hour < OFF_HOURS_START_UTC || hour >= OFF_HOURS_END_UTC) return [];

  const out: AnomalyEvent[] = [];
  for (const dim of ctx.bucketStore.getDimensions(ctx.source)) {
    if (!dim.startsWith("service:")) continue;
    const series = ctx.bucketStore.getSeries(ctx.source, dim, ctx.nowMin);
    const baseline = computeSeasonalBaseline(series, ctx.nowMin);
    out.push(...detectSeasonalAnomalies(series, baseline, ctx.nowMin, { detector: "OFF_HOURS" }));
  }
  return out;
};

// ── Detectors WAF (Fase 4.2) ─────────────────────────────────────────────────

// Pico em qualquer dimensão WAF (attack:*, country:*, tool:*).
const WAF_DIMENSION_PREFIXES = ["attack:", "country:", "tool:"];

export const detectWafBurst = (ctx: DetectorContext): AnomalyEvent[] => {
  const out: AnomalyEvent[] = [];
  for (const dim of ctx.bucketStore.getDimensions(ctx.source)) {
    if (!WAF_DIMENSION_PREFIXES.some(p => dim.startsWith(p))) continue;
    const series = ctx.bucketStore.getSeries(ctx.source, dim, ctx.nowMin);
    if (series.buckets.size === 0) continue;
    const baseline = computeBaseline({ dimension: dim, buckets: series.buckets }, ctx.nowMin);
    out.push(...detectAnomalies(
      { dimension: dim, buckets: series.buckets },
      baseline,
      ctx.nowMin,
      { detector: "WAF_BURST" },
    ));
  }
  return out;
};

// Set-diff: country que aparece nas últimas NEW_ORIGIN_LOOKBACK_MIN e que não
// foi vista no histórico (>NEW_ORIGIN_LOOKBACK_MIN atrás dentro da janela 10d).
// Severidade depende do volume — só dispara com >=10 eventos pra evitar
// ruído de turismo.
const NEW_ORIGIN_LOOKBACK_MIN = 60;
const NEW_ORIGIN_MIN_COUNT = 10;

export const detectNewAttackOrigin = (ctx: DetectorContext): AnomalyEvent[] => {
  const out: AnomalyEvent[] = [];
  const recentCutoff = ctx.nowMin - NEW_ORIGIN_LOOKBACK_MIN;
  for (const dim of ctx.bucketStore.getDimensions(ctx.source)) {
    if (!dim.startsWith("country:")) continue;
    const series = ctx.bucketStore.getSeries(ctx.source, dim, ctx.nowMin);
    let recentCount = 0;
    let historicalCount = 0;
    let firstRecentMin = ctx.nowMin;
    for (const [m, count] of series.buckets) {
      if (m >= recentCutoff) {
        recentCount += count;
        if (m < firstRecentMin) firstRecentMin = m;
      } else {
        historicalCount += count;
      }
    }
    if (historicalCount > 0) continue; // já era conhecido
    if (recentCount < NEW_ORIGIN_MIN_COUNT) continue;

    out.push({
      detector: "NEW_ATTACK_ORIGIN",
      dimension: dim,
      metric: recentCount,
      baseline: 0,
      threshold: 0,
      violationsInWindow: recentCount,
      windowSize: NEW_ORIGIN_LOOKBACK_MIN,
      severity: recentCount >= 100 ? "HIGH" : "MEDIUM",
      detectedAt: new Date(firstRecentMin * MS_PER_MINUTE).toISOString(),
      evidence: [
        `Origem inédita nos últimos ${REFERENCE_WINDOW_DAYS}d`,
        `${recentCount} eventos na última hora`,
        `Padrão: ${dim}`,
      ],
    });
  }
  return out;
};

export const detectors: Detector[] = [
  detectErrorRatePerService,
  detectErrorRatePerEndpoint,
  detectAuthBurst,
  detectNewMessage,
  detectOffHoursVolume,
];

// Detectores WAF rodam contra um source diferente (ctx.source = "waf"). Server
// fn cria um ctx para cada source e roda os detectores aplicáveis.
export const wafDetectors: Detector[] = [
  detectWafBurst,
  detectNewAttackOrigin,
];

// ── Detectors Audit (Fase 4.3) ───────────────────────────────────────────────

// Off-hours em qualquer service de auditoria — usa baseline sazonal.
export const detectAuditOffHours = (ctx: DetectorContext): AnomalyEvent[] => {
  const hour = new Date(ctx.nowMin * MS_PER_MINUTE).getUTCHours();
  if (hour < OFF_HOURS_START_UTC || hour >= OFF_HOURS_END_UTC) return [];

  const out: AnomalyEvent[] = [];
  for (const dim of ctx.bucketStore.getDimensions(ctx.source)) {
    // service:Integra (root) — não service:X:user:Y nem :external_ip
    if (!dim.startsWith("service:") || dim.split(":").length > 2) continue;
    const series = ctx.bucketStore.getSeries(ctx.source, dim, ctx.nowMin);
    const baseline = computeSeasonalBaseline(series, ctx.nowMin);
    out.push(...detectSeasonalAnomalies(series, baseline, ctx.nowMin, { detector: "AUDIT_OFF_HOURS" }));
  }
  return out;
};

// User inédito × histórico 10d, com volume relevante.
const NEW_USER_LOOKBACK_MIN = 60;
const NEW_USER_MIN_COUNT = 10;

export const detectNewAuditUser = (ctx: DetectorContext): AnomalyEvent[] => {
  const out: AnomalyEvent[] = [];
  const recentCutoff = ctx.nowMin - NEW_USER_LOOKBACK_MIN;
  for (const dim of ctx.bucketStore.getDimensions(ctx.source)) {
    // dim = service:X:user:Y → 4 partes
    const parts = dim.split(":");
    if (parts.length !== 4 || parts[0] !== "service" || parts[2] !== "user") continue;
    const series = ctx.bucketStore.getSeries(ctx.source, dim, ctx.nowMin);
    let recent = 0, historical = 0, firstRecent = ctx.nowMin;
    for (const [m, c] of series.buckets) {
      if (m >= recentCutoff) {
        recent += c;
        if (m < firstRecent) firstRecent = m;
      } else historical += c;
    }
    if (historical > 0) continue;
    if (recent < NEW_USER_MIN_COUNT) continue;

    out.push({
      detector: "NEW_AUDIT_USER",
      dimension: dim,
      metric: recent,
      baseline: 0,
      threshold: 0,
      violationsInWindow: recent,
      windowSize: NEW_USER_LOOKBACK_MIN,
      severity: recent >= 100 ? "HIGH" : "MEDIUM",
      detectedAt: new Date(firstRecent * MS_PER_MINUTE).toISOString(),
      evidence: [
        `Usuário inédito nos últimos ${REFERENCE_WINDOW_DAYS}d`,
        `${recent} acessos na última hora`,
        `Padrão: ${dim}`,
      ],
    });
  }
  return out;
};

// Pico de acessos com IP externo via baseline normal (não sazonal).
export const detectExternalIpAuditSpike = (ctx: DetectorContext): AnomalyEvent[] => {
  const out: AnomalyEvent[] = [];
  for (const dim of ctx.bucketStore.getDimensions(ctx.source)) {
    if (!dim.endsWith(":external_ip")) continue;
    const series = ctx.bucketStore.getSeries(ctx.source, dim, ctx.nowMin);
    if (series.buckets.size === 0) continue;
    const baseline = computeBaseline({ dimension: dim, buckets: series.buckets }, ctx.nowMin);
    out.push(...detectAnomalies(
      { dimension: dim, buckets: series.buckets },
      baseline,
      ctx.nowMin,
      { detector: "EXTERNAL_IP_AUDIT_SPIKE" },
    ));
  }
  return out;
};

export const auditDetectors: Detector[] = [
  detectAuditOffHours,
  detectNewAuditUser,
  detectExternalIpAuditSpike,
];

// ── Detectors Infra (Fase 4.4) ───────────────────────────────────────────────

export const detectPodRestartSpike = (ctx: DetectorContext): AnomalyEvent[] => {
  const out: AnomalyEvent[] = [];
  for (const dim of ctx.bucketStore.getDimensions(ctx.source)) {
    if (!dim.startsWith("pod_restart:")) continue;
    const series = ctx.bucketStore.getSeries(ctx.source, dim, ctx.nowMin);
    if (series.buckets.size === 0) continue;
    const baseline = computeBaseline({ dimension: dim, buckets: series.buckets }, ctx.nowMin);
    out.push(...detectAnomalies(
      { dimension: dim, buckets: series.buckets },
      baseline,
      ctx.nowMin,
      { detector: "POD_RESTART_SPIKE" },
    ));
  }
  return out;
};

// Volume de alertas/CPU/restarts em horário off-hours (Datadog mete tudo no
// bucketStore; off-hours é definido como acumular alert_firing fora da janela
// de operação normal).
export const detectInfraOffHours = (ctx: DetectorContext): AnomalyEvent[] => {
  const hour = new Date(ctx.nowMin * MS_PER_MINUTE).getUTCHours();
  if (hour < OFF_HOURS_START_UTC || hour >= OFF_HOURS_END_UTC) return [];

  const out: AnomalyEvent[] = [];
  for (const dim of ctx.bucketStore.getDimensions(ctx.source)) {
    // Foca em alertas e restarts — CPU/disk em horário off-hours não é
    // necessariamente anômalo (batch jobs noturnos).
    if (!dim.startsWith("alert_firing") && !dim.startsWith("pod_restart:")) continue;
    const series = ctx.bucketStore.getSeries(ctx.source, dim, ctx.nowMin);
    const baseline = computeSeasonalBaseline(series, ctx.nowMin);
    out.push(...detectSeasonalAnomalies(series, baseline, ctx.nowMin, { detector: "INFRA_OFF_HOURS" }));
  }
  return out;
};

export const infraDetectors: Detector[] = [
  detectPodRestartSpike,
  detectInfraOffHours,
];
