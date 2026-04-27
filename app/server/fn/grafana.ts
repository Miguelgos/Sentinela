"use server";
import { createServerFn } from "@tanstack/react-start";
import { grafanaPromQuery, grafanaFiringAlerts } from "../../../backend/src/lib/grafanaClient";

// ── getGrafanaKubernetes ──────────────────────────────────────────────────────

export const getGrafanaKubernetes = createServerFn({ method: "GET" }).handler(async () => {
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

  return {
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
  };
});

