import { createServerFn } from "@tanstack/react-start";
import {
  getBucketStore,
  getEventStore,
  getHistoricalClusters,
  isReady,
  storeCoverage,
  storeSize,
  SEQ,
} from "../../../backend/src/accumulators/seqAccumulator";
import {
  auditDetectors,
  buildAnomalyPrompt,
  buildTimelinesForProblems,
  correlateProblems,
  detectors,
  infraDetectors,
  wafDetectors,
  MS_PER_MINUTE,
  type AnomalyEvent,
  type AnomalyProblem,
  type AnomalyTimeline,
  type DetectorContext,
} from "../../../backend/src/anomaly";
import {
  getWafBucketStore,
  getWafEventStore,
  isWafReady,
  WAF,
} from "../../../backend/src/accumulators/wafAccumulator";
import {
  getAuditBucketStore,
  getAuditEventStore,
  isAuditReady,
  AUDIT,
} from "../../../backend/src/accumulators/auditAccumulator";
import {
  getInfraBucketStore,
  isInfraReady,
  INFRA,
} from "../../../backend/src/accumulators/infraAccumulator";
import { EventStore } from "../../../backend/src/timeseries/eventStore";
import { aiNarrative } from "../../../backend/src/lib/aiClient";

export interface AnomalyReport {
  generatedAt: string;
  ready: boolean;
  coverage: { oldest: string | undefined; newest: string | undefined };
  totalEvents: number;
  problems: AnomalyProblem[];
  anomalies: AnomalyEvent[];
  timelines: AnomalyTimeline[];
  narrativeError?: string;
}

// Limita chamadas AI ao top-N problemas pra controlar custo/latência. AI corre
// em paralelo (Promise.allSettled) — falhas individuais não bloqueiam outras.
const MAX_AI_NARRATIVES = 5;

async function attachNarratives(problems: AnomalyProblem[]): Promise<{ narrativeError?: string }> {
  const top = problems.slice(0, MAX_AI_NARRATIVES);
  if (top.length === 0) return {};

  const results = await Promise.allSettled(
    top.map(p => aiNarrative(buildAnomalyPrompt(p))),
  );

  let narrativeError: string | undefined;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      top[i].narrative = r.value.trim();
    } else {
      const msg = String(r.reason);
      if (!narrativeError) {
        narrativeError = msg.includes("PROXY_BLOCKED")
          ? "API bloqueada pelo firewall corporativo. Solicite ao TI o desbloqueio."
          : `Análise automática indisponível: ${msg.replace(/^Error: /, "")}`;
      }
    }
  });
  return narrativeError ? { narrativeError } : {};
}

export const getAnomalyReport = createServerFn({ method: "GET" }).handler(async (): Promise<AnomalyReport> => {
  const nowMin = Math.floor(Date.now() / MS_PER_MINUTE);

  const seqCtx: DetectorContext = {
    bucketStore: getBucketStore(),
    eventStore: getEventStore(),
    historicalClusters: getHistoricalClusters(),
    nowMin,
    source: SEQ,
  };
  const wafCtx: DetectorContext = {
    bucketStore: getWafBucketStore(),
    eventStore: getWafEventStore() as unknown as DetectorContext["eventStore"],
    historicalClusters: new Set(),
    nowMin,
    source: WAF,
  };
  const auditCtx: DetectorContext = {
    bucketStore: getAuditBucketStore(),
    eventStore: getAuditEventStore() as unknown as DetectorContext["eventStore"],
    historicalClusters: new Set(),
    nowMin,
    source: AUDIT,
  };
  // Infra não tem eventStore (só métricas) — usa stub vazio.
  const infraCtx: DetectorContext = {
    bucketStore: getInfraBucketStore(),
    eventStore: new EventStore() as unknown as DetectorContext["eventStore"],
    historicalClusters: new Set(),
    nowMin,
    source: INFRA,
  };

  const anomalies = [
    ...detectors.flatMap(detect => detect(seqCtx)),
    ...wafDetectors.flatMap(detect => detect(wafCtx)),
    ...auditDetectors.flatMap(detect => detect(auditCtx)),
    ...infraDetectors.flatMap(detect => detect(infraCtx)),
  ];
  const problems = correlateProblems(anomalies);
  // Timelines: usa o ctx do source da anomaly head — implementação simples
  // pega só do Seq por enquanto. Próxima iteração: timelines multi-source.
  const timelines = buildTimelinesForProblems(problems, seqCtx);

  const { narrativeError } = await attachNarratives(problems);

  return {
    generatedAt: new Date().toISOString(),
    ready: isReady() && isWafReady() && isAuditReady() && isInfraReady(),
    coverage: storeCoverage(),
    totalEvents: storeSize(),
    problems,
    anomalies,
    timelines,
    ...(narrativeError ? { narrativeError } : {}),
  };
});
