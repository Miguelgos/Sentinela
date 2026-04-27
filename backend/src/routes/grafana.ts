import { Router } from "express";
import { grafanaPromQuery, grafanaFiringAlerts } from "../lib/grafanaClient";

const router = Router();

// GET /api/grafana/kubernetes
router.get("/kubernetes", async (_req, res) => {
  try {
    const [
      cpuRes, memRes, restartsRes,
      desiredRes, availableRes,
      downRes, allRestartsRes,
      alertsRes,
    ] = await Promise.allSettled([
      grafanaPromQuery('rate(container_cpu_usage_seconds_total{namespace="integra-prd",container="app",pod=~"salesbo.*"}[5m])*100'),
      grafanaPromQuery('container_memory_working_set_bytes{namespace="integra-prd",container="app",pod=~"salesbo.*"}'),
      grafanaPromQuery('kube_pod_container_status_restarts_total{namespace="integra-prd",pod=~"salesbo.*",container="app"}'),
      grafanaPromQuery('kube_deployment_spec_replicas{namespace="integra-prd",deployment="salesbo"}'),
      grafanaPromQuery('kube_deployment_status_replicas_available{namespace="integra-prd",deployment="salesbo"}'),
      grafanaPromQuery('kube_deployment_status_replicas_available{namespace="integra-prd"} == 0'),
      grafanaPromQuery('sum by (pod)(kube_pod_container_status_restarts_total{namespace="integra-prd"}) > 0'),
      grafanaFiringAlerts(),
    ]);

    // helpers
    function settled<T>(r: PromiseSettledResult<T>, fallback: T): T {
      return r.status === "fulfilled" ? r.value : fallback;
    }

    const cpuData      = settled(cpuRes,      []);
    const memData      = settled(memRes,       []);
    const restartsData = settled(restartsRes,  []);
    const desiredData  = settled(desiredRes,   []);
    const availData    = settled(availableRes, []);
    const downData     = settled(downRes,      []);
    const allRestarts  = settled(allRestartsRes, []);
    const alerts       = settled(alertsRes,    []);

    // merge salesbo pods by pod label
    const podMap: Record<string, { name: string; cpuPct: number; memMb: number; restarts: number }> = {};

    for (const r of cpuData) {
      const pod = r.metric.pod ?? "";
      if (!pod) continue;
      if (!podMap[pod]) podMap[pod] = { name: pod, cpuPct: 0, memMb: 0, restarts: 0 };
      podMap[pod].cpuPct = parseFloat(r.value[1]) || 0;
    }
    for (const r of memData) {
      const pod = r.metric.pod ?? "";
      if (!pod) continue;
      if (!podMap[pod]) podMap[pod] = { name: pod, cpuPct: 0, memMb: 0, restarts: 0 };
      podMap[pod].memMb = (parseFloat(r.value[1]) || 0) / 1024 / 1024;
    }
    for (const r of restartsData) {
      const pod = r.metric.pod ?? "";
      if (!pod) continue;
      if (!podMap[pod]) podMap[pod] = { name: pod, cpuPct: 0, memMb: 0, restarts: 0 };
      podMap[pod].restarts = parseFloat(r.value[1]) || 0;
    }

    const pods = Object.values(podMap).sort((a, b) => a.name.localeCompare(b.name));

    const totalCpuPct = Math.round(pods.reduce((s, p) => s + p.cpuPct, 0) * 10) / 10;
    const totalMemGb  = Math.round((pods.reduce((s, p) => s + p.memMb, 0) / 1024) * 100) / 100;

    const desiredReplicas   = desiredData.length  > 0 ? parseFloat(desiredData[0].value[1])  || 0 : 0;
    const availableReplicas = availData.length    > 0 ? parseFloat(availData[0].value[1])    || 0 : 0;

    const deploymentsDown = downData
      .map((r) => r.metric.deployment)
      .filter((d): d is string => Boolean(d));

    const podRestarts = allRestarts
      .map((r) => ({
        pod:      r.metric.pod ?? "",
        restarts: Math.round(parseFloat(r.value[1]) || 0),
      }))
      .sort((a, b) => b.restarts - a.restarts);

    res.json({
      salesbo: {
        replicas: {
          available: availableReplicas,
          desired:   desiredReplicas,
        },
        totalCpuPct,
        totalMemGb,
        pods,
      },
      deploymentsDown,
      podRestarts,
      alerts,
    });
  } catch (err) {
    console.error("[grafana] kubernetes error:", err);
    res.status(502).json({ error: String(err) });
  }
});

// GET /api/grafana/jobscheduler
router.get("/jobscheduler", async (_req, res) => {
  try {
    const [
      processedRes, errorsRes, errorsHourRes,
      activeRes, durationRes,
    ] = await Promise.allSettled([
      grafanaPromQuery('sum by (provider_name)(jobscheduler_events_processed_total{job="jobscheduler"})'),
      grafanaPromQuery('sum by (provider_name)(jobscheduler_events_errors_total{job="jobscheduler"})'),
      grafanaPromQuery('sum by (provider_name)(increase(jobscheduler_events_errors_total{job="jobscheduler"}[1h]))'),
      grafanaPromQuery('sum by (provider_name)(jobscheduler_provider_active_requests{job="jobscheduler"})'),
      grafanaPromQuery('sum by (provider_name)(rate(jobscheduler_events_duration_ms_milliseconds_sum{job="jobscheduler"}[5m])) / sum by (provider_name)(rate(jobscheduler_events_duration_ms_milliseconds_count{job="jobscheduler"}[5m]))'),
    ]);

    function settled<T>(r: PromiseSettledResult<T>, fallback: T): T {
      return r.status === "fulfilled" ? r.value : fallback;
    }

    const processedData  = settled(processedRes,   []);
    const errorsData     = settled(errorsRes,       []);
    const errorsHourData = settled(errorsHourRes,   []);
    const activeData     = settled(activeRes,       []);
    const durationData   = settled(durationRes,     []);

    // merge all by provider_name
    const providerMap: Record<string, {
      name: string;
      processed: number;
      errors: number;
      errorsLastHour: number;
      avgDurationMs: number;
      activeRequests: number;
    }> = {};

    function ensureProvider(name: string) {
      if (!providerMap[name]) {
        providerMap[name] = { name, processed: 0, errors: 0, errorsLastHour: 0, avgDurationMs: 0, activeRequests: 0 };
      }
    }

    for (const r of processedData) {
      const name = r.metric.provider_name ?? "";
      if (!name) continue;
      ensureProvider(name);
      providerMap[name].processed = parseFloat(r.value[1]) || 0;
    }
    for (const r of errorsData) {
      const name = r.metric.provider_name ?? "";
      if (!name) continue;
      ensureProvider(name);
      providerMap[name].errors = parseFloat(r.value[1]) || 0;
    }
    for (const r of errorsHourData) {
      const name = r.metric.provider_name ?? "";
      if (!name) continue;
      ensureProvider(name);
      providerMap[name].errorsLastHour = parseFloat(r.value[1]) || 0;
    }
    for (const r of activeData) {
      const name = r.metric.provider_name ?? "";
      if (!name) continue;
      ensureProvider(name);
      providerMap[name].activeRequests = parseFloat(r.value[1]) || 0;
    }
    for (const r of durationData) {
      // duration query may have different label structure — handle gracefully
      const name = r.metric.provider_name ?? "";
      if (!name) continue;
      ensureProvider(name);
      const v = parseFloat(r.value[1]);
      providerMap[name].avgDurationMs = isNaN(v) ? 0 : v;
    }

    const providers = Object.values(providerMap)
      .map((p) => {
        const errorRate =
          p.errors > 0 && p.processed > 0
            ? Math.round((p.errors / p.processed) * 100 * 100) / 100
            : 0;
        return { ...p, errorRate };
      })
      .sort((a, b) => b.processed - a.processed);

    const totalProcessed = providers.reduce((s, p) => s + p.processed, 0);
    const totalErrors    = providers.reduce((s, p) => s + p.errors,    0);
    const totalErrorRate =
      totalErrors > 0 && totalProcessed > 0
        ? Math.round((totalErrors / totalProcessed) * 100 * 100) / 100
        : 0;

    res.json({
      providers,
      totals: {
        processed: totalProcessed,
        errors:    totalErrors,
        errorRate: totalErrorRate,
      },
    });
  } catch (err) {
    console.error("[grafana] jobscheduler error:", err);
    res.status(502).json({ error: String(err) });
  }
});

export default router;
