import https from "https";

// Defensivo: aceita endpoint com ou sem o sufixo /chat/completions.
// Em prd o secret guarda só ".../openai/v1" e o app precisa adicionar
// o path da operação. Local pode estar configurado com path completo.
function chatCompletionsUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

export async function aiNarrative(prompt: string): Promise<string> {
  const endpoint   = process.env.AZURE_OPENAI_ENDPOINT   || "";
  const apiKey     = process.env.AZURE_OPENAI_KEY        || "";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "sentinela";

  const body = JSON.stringify({
    model:                 deployment,
    messages:              [{ role: "user", content: prompt }],
    max_completion_tokens: 1024,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(chatCompletionsUrl(endpoint));
    const options: https.RequestOptions = {
      hostname:           url.hostname,
      path:               url.pathname + url.search,
      method:             "POST",
      rejectUnauthorized: false,
      headers: {
        "api-key":        apiKey,
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 30000,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        reject(new Error(`PROXY_BLOCKED: API bloqueada pelo firewall corporativo (${res.statusCode} → ${res.headers.location ?? ""})`));
        res.resume();
        return;
      }
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        if (!data.trim()) {
          reject(new Error("PROXY_BLOCKED: Resposta vazia — possível bloqueio de proxy"));
          return;
        }
        try {
          const json = JSON.parse(data);
          if (json?.error) {
            reject(new Error(`Azure OpenAI error: ${json.error.message}`));
            return;
          }
          const text = (json?.choices?.[0]?.message?.content ?? "") as string;
          if (!text) {
            reject(new Error("Azure OpenAI retornou resposta vazia"));
            return;
          }
          resolve(text);
        } catch {
          reject(new Error(`Azure OpenAI resposta inválida (status ${res.statusCode}): ${data.slice(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Azure OpenAI timeout")); });
    req.write(body);
    req.end();
  });
}
