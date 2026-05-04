# Sentinela

Dashboard interno da Ituran que correlaciona logs (Seq), métricas (Datadog), proteção de borda (GoCache WAF), auditoria (Loki) e infraestrutura (Grafana/Prometheus) para monitoramento e relatório de ameaças do `salesbo` em `integra-prd`.

URL prd: <https://crm.ituran.sp/sentinela>

## Stack

- **TanStack Start** (Vite SSR puro, sem Vinxi/Nitro) com basepath `/sentinela`
- **React 19** + Tailwind + shadcn/ui + TanStack Query/Table + Recharts
- **Adapter Node** próprio: `@hono/node-server` + `serveStatic` em `node-server.mjs`
- **Auth**: Supabase (email/senha + Microsoft OAuth)
- **LLM**: Azure OpenAI Foundry interno
- **Store**: `Map` em memória, 7d, cap 100k eventos (compactos)
- **Build**: pnpm com `node-linker=hoisted`

## Rodar local

```bash
pnpm install
cp backend/.env.example backend/.env   # se ainda não existir
pnpm run dev          # vite dev em :5173 (HMR)
pnpm run build        # build produção em dist/
pnpm run start        # roda dist/ via node-server.mjs em :3000
pnpm run test:e2e     # smoke tests Playwright
```

## Estrutura

```
app/                    # rotas TanStack Start + server functions
backend/                # accumulator, clientes (Seq/DD/GC/Grafana/Loki/Azure OpenAI), MSSQL, parsers
frontend/               # React UI, hooks, lib
docs/                   # documentação (ver docs/README.md)
node-server.mjs         # adapter HTTP Node (Hono + serveStatic + dist/server fetch)
```

## Deploy

Push em `main` → pipeline ADO id 630 builda imagem em `ituran.azurecr.io/integra/sentinela:latest` → Keel detecta e rola Deployment em `integra-prd`. Detalhes em [`docs/deploy/kubernetes.md`](docs/deploy/kubernetes.md).
