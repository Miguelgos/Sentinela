import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import server from "./dist/server/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(__dirname, "dist/client");

const app = new Hono();

// Static do client bundle (assets, favicon, etc) sob o basepath /sentinela.
// Quando o arquivo não existe, cai para o handler do TanStack Start abaixo.
app.use(
  "/sentinela/*",
  serveStatic({
    root: clientDir,
    rewriteRequestPath: (path) => path.replace(/^\/sentinela/, ""),
    onFound: (_path, c) => {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    },
  }),
);

// SSR + server functions + API routes
app.all("*", (c) => server.fetch(c.req.raw));

const port = Number(process.env.PORT ?? 3000);

serve(
  { fetch: app.fetch, port, hostname: "0.0.0.0" },
  (info) => console.log(`[sentinela] listening on http://0.0.0.0:${info.port}`),
);
