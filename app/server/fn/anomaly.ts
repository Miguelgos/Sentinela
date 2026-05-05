import { createServerFn } from "@tanstack/react-start";
import { getEvents, isReady, storeCoverage } from "../../../backend/src/accumulator";
import {
  buildAnomalyPrompt,
  buildTimelinesForProblems,
  correlateProblems,
  detectors,
  MS_PER_MINUTE,
  type AnomalyEvent,
  type AnomalyProblem,
  type AnomalyTimeline,
} from "../../../backend/src/anomaly";
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
  const events = getEvents();
  const nowMin = Math.floor(Date.now() / MS_PER_MINUTE);

  const anomalies = detectors.flatMap(detect => detect(events, nowMin));
  const problems = correlateProblems(anomalies);
  const timelines = buildTimelinesForProblems(problems, events, nowMin);

  const { narrativeError } = await attachNarratives(problems);

  return {
    generatedAt: new Date().toISOString(),
    ready: isReady(),
    coverage: storeCoverage(),
    totalEvents: events.length,
    problems,
    anomalies,
    timelines,
    ...(narrativeError ? { narrativeError } : {}),
  };
});
