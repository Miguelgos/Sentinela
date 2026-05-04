import { createServerFn } from "@tanstack/react-start";
import { aiNarrative } from "../../../backend/src/lib/aiClient";
import {
  fetchThreatContext,
  rules,
  maxRisk,
  buildPrompt,
  type CorrelatedThreat,
} from "../../../backend/src/threat";

export const getThreatReport = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await fetchThreatContext();
  const findings = rules
    .map(rule => rule(ctx))
    .filter((f): f is CorrelatedThreat => f !== null);
  const overallRisk = maxRisk(findings);

  const prompt = buildPrompt(ctx, findings, overallRisk);

  let narrative = "";
  let narrativeError: string | null = null;
  try {
    narrative = await aiNarrative(prompt);
  } catch (err) {
    const msg = String(err);
    console.error("[report] AI error:", msg);
    narrativeError = msg.startsWith("Error: PROXY_BLOCKED")
      ? "API bloqueada pelo firewall corporativo. Solicite ao TI o desbloqueio."
      : `Análise automática indisponível: ${msg.replace(/^Error: /, "")}`;
    narrative = findings.length > 0
      ? `${narrativeError}\n\nAmeaças identificadas:\n${findings.map(f => `• [${f.risk}] ${f.title}`).join("\n")}`
      : narrativeError;
  }

  return {
    generatedAt: new Date().toISOString(),
    riskLevel: overallRisk,
    findings,
    narrative,
    ...(narrativeError ? { narrativeError } : {}),
    sources: {
      seq:     { ok: ctx.sources.seqOk, events:  ctx.seqEvents.length },
      datadog: { ok: ctx.sources.ddOk,  alerts:  ctx.alertMonitors.length },
      gocache: { ok: ctx.sources.gcOk,  blocked: ctx.gcBlockedTotal },
      audit:   { ok: ctx.auditTotal > 0, events: ctx.auditTotal },
    },
  };
});
