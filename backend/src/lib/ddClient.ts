import https from "https";

export function ddFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const DD_SITE    = process.env.DD_SITE    || "us5.datadoghq.com";
  const DD_API_KEY = process.env.DD_API_KEY || "";
  const DD_APP_KEY = process.env.DD_APP_KEY || "";
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options: https.RequestOptions = {
      hostname: `api.${DD_SITE}`,
      path,
      method,
      family: 4,
      rejectUnauthorized: false,
      headers: {
        "DD-API-KEY":           DD_API_KEY,
        "DD-APPLICATION-KEY":   DD_APP_KEY,
        "Content-Type":         "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
      timeout: 15000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Datadog request timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}
