// Infra accumulator — métricas Datadog (CPU, disk, pod restarts) bucketizadas.
// Datadog é fonte de métrica (não evento), então polling 5min é suficiente —
// não saturamos a API e métricas mudam devagar.
//
// Dimensões:
//   pod_restart:{deployment}     — incrementa quando deployment teve restart no minuto
//   cpu_high:{host}              — bump quando host > 85% CPU
//   disk_high:{host}             — bump quando host > 90% disk
//   alert_firing                 — bump por monitor em estado Alert/Warn

import { ddFetch } from "../lib/ddClient";
import { BucketStore } from "../timeseries/bucketStore";
import { REFERENCE_WINDOW_DAYS } from "../timeseries/types";

const _bucketStore = new BucketStore();
const INFRA_SOURCE = "infra";

export const INFRA = INFRA_SOURCE;

let _syncPhase: "idle" | "syncing" | "done" | "error" = "idle";
let _lastPoll: string | null = null;

interface SeriesPoint { scope: string; value: number }

function extractMetric(raw: unknown): SeriesPoint[] {
  const series = (((raw as Record<string, unknown>)?.series ?? []) as Record<string, unknown>[]);
  return series.map(s => {
    const pts = (s.pointlist ?? []) as [number, number | null][];
    const last = [...pts].reverse().find(p => p[1] !== null);
    return { scope: String(s.scope ?? ""), value: last ? last[1]! : 0 };
  });
}

const REFRESH_MS = 5 * 60_000;

async function pollMetrics(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const from1h = now - 3600;
  const minute = Math.floor(Date.now() / 60_000);

  try {
    const [cpuRaw, podRaw, diskRaw, monitorsRaw] = await Promise.allSettled([
      ddFetch(`/api/v1/query?from=${from1h}&to=${now}&query=${encodeURIComponent("avg:system.cpu.user{*}by{host}")}`),
      ddFetch(`/api/v1/query?from=${from1h}&to=${now}&query=${encodeURIComponent("sum:kubernetes.containers.restarts{*}by{kube_deployment}")}`),
      ddFetch(`/api/v1/query?from=${from1h}&to=${now}&query=${encodeURIComponent("avg:system.disk.in_use{*}by{host}")}`),
      ddFetch("/api/v1/monitor?with_downtimes=false&page=0&page_size=100"),
    ]);

    const dims: Record<string, number> = {};

    if (cpuRaw.status === "fulfilled") {
      const cpu = extractMetric(cpuRaw.value);
      for (const s of cpu) {
        if (s.value > 85) dims[`cpu_high:${s.scope.replace("host:", "")}`] = 1;
      }
    }
    if (diskRaw.status === "fulfilled") {
      const disk = extractMetric(diskRaw.value);
      for (const s of disk) {
        if (s.value > 0.9) dims[`disk_high:${s.scope.replace("host:", "")}`] = 1;
      }
    }
    if (podRaw.status === "fulfilled") {
      const pods = extractMetric(podRaw.value).filter(s => s.value > 0);
      for (const s of pods) {
        const dep = s.scope.replace("kube_deployment:", "");
        dims[`pod_restart:${dep}`] = Math.round(s.value);
      }
    }
    if (monitorsRaw.status === "fulfilled" && Array.isArray(monitorsRaw.value)) {
      const alerting = (monitorsRaw.value as Record<string, unknown>[]).filter(m => {
        const state = String(m.overall_state ?? "");
        return state === "Alert" || state === "Warn";
      });
      if (alerting.length > 0) dims.alert_firing = alerting.length;
    }

    if (Object.keys(dims).length > 0) {
      _bucketStore.bumpMany(INFRA_SOURCE, minute, dims);
      _bucketStore.rotateTo(INFRA_SOURCE, minute);
    }
    _lastPoll = new Date().toISOString();
  } catch (err) {
    console.error("[infraAccumulator] erro polling:", err);
  }
}

export async function initInfraAccumulator(): Promise<void> {
  // Datadog não oferece backfill granular de monitors/alerts, e métricas
  // (CPU, restarts, disk) podem ser fetchadas mas teriam que ser por hora.
  // Mantém simples: só polling forward — baseline cresce gradualmente.
  // Em REFERENCE_WINDOW_DAYS dias, baseline está completa.
  setInterval(() => {
    pollMetrics().catch(err => console.error("[infraAccumulator] erro refresh:", err));
  }, REFRESH_MS);

  // Primeira execução imediata.
  pollMetrics().then(() => {
    _syncPhase = "done";
    console.log(`[infraAccumulator] iniciado — janela ${REFERENCE_WINDOW_DAYS}d cresce gradualmente`);
  }).catch(err => {
    _syncPhase = "error";
    console.error("[infraAccumulator] erro no boot:", err);
  });
}

// ── API pública ──────────────────────────────────────────────────────────────

export function getInfraBucketStore(): BucketStore { return _bucketStore; }
export function isInfraReady(): boolean { return _syncPhase === "done"; }
export function getInfraLastPoll(): string | null { return _lastPoll; }
