import https from "https";

export async function geminiNarrative(prompt: string): Promise<string> {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
  const body = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      rejectUnauthorized: false,
      headers: {
        "x-api-key":         ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type":      "application/json",
        "Content-Length":    Buffer.byteLength(body),
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
            reject(new Error(`Anthropic API error ${json.error.type}: ${json.error.message}`));
            return;
          }
          const text = (json?.content?.[0]?.text ?? "") as string;
          if (!text) {
            reject(new Error("Claude retornou resposta vazia"));
            return;
          }
          resolve(text);
        } catch {
          reject(new Error(`Anthropic resposta inválida (status ${res.statusCode}): ${data.slice(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Anthropic timeout")); });
    req.write(body);
    req.end();
  });
}
