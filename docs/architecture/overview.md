# Arquitetura — Visão Geral

## Stack

| Camada | Tecnologia |
|---|---|
| Servidor HTTP | Node 24 + `@hono/node-server` + `Hono` (`node-server.mjs`) |
| SSR/Router | TanStack Start v1 (Vite SSR puro), basepath `/sentinela` |
| Frontend | React 19 + Tailwind + shadcn/ui + TanStack Query/Table + Recharts |
| Auth | Supabase (Microsoft OAuth + email/senha) |
| Stores de eventos | `BucketStore` (séries temporais 10d) + `EventStore` (raw 2h) por accumulator, ~250-300 MB total |
| LLM | Azure OpenAI Foundry interno (deployment `sentinela`) |
| Lookups | SQL Server `ituranweb` (via `ConnectionStrings__ITURANWEB`) |
| Build | pnpm 9 com `node-linker=hoisted` |
| Probes | `/sentinela/api/health` (route file TanStack) |

## Fluxo de dados

```
                        ┌─────────────┐
                        │  Browser    │
                        └──────┬──────┘
                               │ HTTPS
                ┌──────────────┴──────────────┐
                │  F5 BigIP (crm.ituran.sp)   │
                └──────────────┬──────────────┘
                               │
                       ┌───────┴───────┐
                       │  Kong DBless  │  ─── /sentinela → strip_path:false
                       └───────┬───────┘
                               │
                ┌──────────────┴──────────────┐
                │  Pod sentinela (integra-prd)│
                │  ┌───────────────────────┐  │
                │  │ node-server.mjs       │  │
                │  │  ├─ /sentinela/* →    │  │
                │  │  │  serveStatic dist/ │  │
                │  │  └─ resto →           │  │
                │  │     server.fetch (SSR)│  │
                │  └───────────────────────┘  │
                │  ┌───────────────────────┐  │
                │  │ Accumulators (loop 60s)│ │
                │  │  seq | kong | login   │──┼─→ Seq
                │  │  waf                  │──┼─→ GoCache
                │  │  audit                │──┼─→ Loki (via Grafana)
                │  │  infra                │──┼─→ Datadog
                │  └───────────────────────┘  │
                └──────────────┬──────────────┘
                               │
        ┌────────┬────────┬────┴────┬────────┬───────────┐
        ▼        ▼        ▼         ▼        ▼           ▼
       Seq   Datadog   GoCache   Grafana   Azure       MSSQL
                                            OpenAI
```

## Componentes

- **`node-server.mjs`** — entry de produção. Liga `@hono/node-server` ao handler do TanStack Start (`dist/server/server.js`) e serve `dist/client/*` em `/sentinela/*`. Sem ele, `dist/server/server.js` só exporta `{ fetch }` e nada escuta na porta.

- **`backend/src/accumulators/*`** — vários accumulators independentes em memória (Seq, Kong, Login, WAF, Audit, Infra), cada um com boot não-bloqueante: `setInterval(refresh, 60s)` arma imediato, sync de 10d roda em background. Detalhes em [`accumulator.md`](accumulator.md).

- **`app/server/fn/*`** — server functions do TanStack Start: `events`, `report`, `pessoa`, `datadog`, `gocache`, `grafana`, `audit`. Memoize de 5 min em `getAuthErrorStats`, `getKongAuthStats` e `getLoginOverview` pra reduzir pressão de licença no Seq.

- **`app/routes/__root.tsx`** — injeta `<script>window.__ENV__ = {...}</script>` no `<head>` lendo `process.env.VITE_*` server-side. Cliente lê via `frontend/src/lib/supabase.ts`. Imagem é genérica entre ambientes.

- **`frontend/src/components/SyncBanner.tsx`** — banner âmbar de progresso enquanto o accumulator faz o sync inicial.

## Pontos de atenção

- **Vite `base: "/sentinela/"`** no `vite.config.ts` é independente do `tanstackStart router.basepath`. Os dois precisam apontar pro mesmo basepath.
- **`raw_data` no store** é truncado a `{ Properties }` via `compactEvent` — outros campos do `SeqApiEvent` (Tokens, Links, etc) não são persistidos no Map.
- **Egress** do `integra-prd` precisa alcançar: `seq-prd.ituran.sp:443`, `iturin-ai-eastus2-resource.openai.azure.com:443`, `api.us5.datadoghq.com:443`, `api.gocache.com.br:443`, `grafana-prd.ituran.sp:80`, `DB_INTEGRA_PRD\PRD02` (UDP/1434 + TCP dyn).
