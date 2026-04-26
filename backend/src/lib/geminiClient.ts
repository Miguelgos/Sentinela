import https from "https";

export async function geminiNarrative(prompt: string): Promise<string> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
  });

  return new Promise((resolve, reject) => {
    const path = `/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const options: https.RequestOptions = {
      hostname: "generativelanguage.googleapis.com",
      path,
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 30000,
    };

    const req = https.request(options, (res) => {
      // Detect corporate proxy block page (Forcepoint 302 redirect)
      if (res.statusCode === 302 || res.statusCode === 301) {
        reject(new Error(`PROXY_BLOCKED: Gemini bloqueado pelo firewall corporativo (${res.statusCode} → ${res.headers.location ?? ""})`));
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
            reject(new Error(`Gemini API error ${json.error.code}: ${json.error.message}`));
            return;
          }
          const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "") as string;
          if (!text) {
            reject(new Error("Gemini retornou resposta vazia"));
            return;
          }
          resolve(text);
        } catch {
          reject(new Error(`Gemini resposta inválida (status ${res.statusCode}): ${data.slice(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Gemini timeout")); });
    req.write(body);
    req.end();
  });
}
