import { serve } from "@hono/node-server";
import server from "./dist/server/server.js";

const port = Number(process.env.PORT ?? 3000);

serve(
  {
    fetch: (request) => server.fetch(request),
    port,
    hostname: "0.0.0.0",
  },
  (info) => {
    console.log(`[sentinela] listening on http://0.0.0.0:${info.port}`);
  },
);
