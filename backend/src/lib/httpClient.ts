import http from "http";
import https from "https";

interface ClientOptions {
  baseUrl: string;
  headers: Record<string, string>;
  timeoutMs?: number;
  rejectUnauthorized?: boolean;
}

export function makeClient(opts: ClientOptions) {
  const base = new URL(opts.baseUrl);
  const mod  = base.protocol === "https:" ? https : http;
  const timeout = opts.timeoutMs ?? 15_000;

  return function request(path: string, method = "GET", body?: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const options = {
        hostname: base.hostname,
        port:     base.port || (base.protocol === "https:" ? 443 : 80),
        path,
        method,
        family:   4,
        rejectUnauthorized: opts.rejectUnauthorized ?? false,
        headers: {
          ...opts.headers,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout,
      };

      const req = mod.request(options, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          try   { resolve(JSON.parse(data)); }
          catch { resolve(null); }
        });
      });
      req.on("error",   () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
      if (payload) req.write(payload);
      req.end();
    });
  };
}
