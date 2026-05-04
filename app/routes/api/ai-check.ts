import { createFileRoute } from "@tanstack/react-router";
import { aiNarrative } from "../../../backend/src/lib/aiClient";

// Healthcheck de integração com Azure OpenAI Foundry.
// Retorna 200 com latência real, ou 503 com mensagem de erro.
// Usado pelo smoke test e debug rápido sem precisar abrir o Threat Report.
export const Route = createFileRoute("/api/ai-check")({
  server: {
    handlers: {
      GET: async () => {
        const startedAt = Date.now();
        try {
          const text = await aiNarrative("Responda em uma palavra: ok");
          return new Response(
            JSON.stringify({
              ok: true,
              model: process.env.AZURE_OPENAI_DEPLOYMENT ?? "sentinela",
              elapsedMs: Date.now() - startedAt,
              sample: text.slice(0, 80),
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: String(err),
              elapsedMs: Date.now() - startedAt,
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
