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
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "") as string;
          resolve(text);
        } catch {
          reject(new Error(`Gemini invalid response: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Gemini timeout")); });
    req.write(body);
    req.end();
  });
}
