import https from "https";

const GC_BASE = "api.gocache.com.br";

export function gcFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const GC_TOKEN = process.env.GC_TOKEN || "";
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options: https.RequestOptions = {
      hostname: GC_BASE,
      path,
      method,
      rejectUnauthorized: false,
      headers: {
        "GoCache-Token": GC_TOKEN,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
      timeout: 12000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("GoCache timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}
