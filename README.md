# Sentinela

Dashboard web de inteligência de logs e segurança para o serviço `salesbo` da Ituran, ambiente `integra-prd`.

## Contexto

O **Sentinela** monitora em tempo real os eventos do serviço `salesbo` (Sales Backoffice) publicados no Seq em `https://seq-prd.ituran.sp`. Consome esses eventos, persiste localmente em PostgreSQL e fornece análises focadas nos seguintes padrões:

1. **GUID de Cotação vazio** — endpoint `Quote/PrintItens` chamado com `GUID_COTACAO: 00000000-0000-0000-0000-000000000000`
2. **Falhas de autenticação** — endpoint `/connect/token` com fluxo ResourceOwner retornando `Unauthorized`
3. **Kong Auth Request com falhas** — requisições via Kong com `StatusCode != 200`
4. **Análise de Segurança** — findings de segurança com severidade (Critical/High/Medium/Low)
5. **Datadog** — monitores, logs, hosts, métricas IIS e SQL Server
6. **GoCache WAF** — eventos WAF, firewall, bot mitigation nas últimas 24h

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| Backend | Node.js + Express + TypeScript |
| Banco principal | PostgreSQL 16 (Docker) |
| Banco auxiliar | SQL Server (`ituranweb` — lookup de nomes de pessoa) |
| Gráficos | Recharts |
| PDF export | jsPDF + jspdf-autotable |
| HTTP (interno) | `https` nativo do Node (TLS sem verificação de certificado) |
| Monitoramento externo | Datadog (us5.datadoghq.com) + GoCache WAF API |

## Estrutura

```
seq-analyzer/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── index.ts        # Pool pg
│   │   │   ├── mssql.ts        # Conexão SQL Server
│   │   │   └── schema.sql      # DDL inicial
│   │   ├── routes/
│   │   │   ├── events.ts       # CRUD + estatísticas (inclui /stats/security e /stats/kong-auth)
│   │   │   ├── sync.ts         # Sync manual
│   │   │   ├── autosync.ts     # Controle de auto-sync (rota)
│   │   │   ├── pessoa.ts       # Lookup de nomes
│   │   │   ├── datadog.ts      # Integração Datadog (monitors, logs, hosts, métricas IIS/SQL)
│   │   │   └── gocache.ts      # Integração GoCache WAF (WAF, firewall, bot)
│   │   ├── autosync.ts         # Módulo de auto-sync incremental com retenção
│   │   ├── sync-core.ts        # Funções compartilhadas de sync + deleteOldEvents
│   │   ├── types.ts            # Parsers e tipos
│   │   └── index.ts            # Entry point + bootstrap
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                    # Primitivos shadcn/ui
│   │   │   ├── SentinelaLogo.tsx      # Ícone SVG da marca (sidebar)
│   │   │   ├── Dashboard.tsx          # Dashboard principal
│   │   │   ├── LogsTable.tsx          # Tabela de eventos
│   │   │   ├── ErrorAnalysis.tsx      # Análise GUID vazio
│   │   │   ├── AuthErrorAnalysis.tsx  # Análise auth failures
│   │   │   ├── KongAuthAnalysis.tsx   # Análise Kong Auth (StatusCode != 200)
│   │   │   ├── SecurityAnalysis.tsx   # Análise de segurança (findings)
│   │   │   ├── DatadogAnalysis.tsx    # Datadog — monitores, logs, hosts, IIS, SQL
│   │   │   ├── GoCacheAnalysis.tsx    # GoCache WAF — WAF, firewall, bot mitigation
│   │   │   ├── SyncConfig.tsx         # Configuração de sync
│   │   │   └── EventDetail.tsx        # Modal de detalhe de evento
│   │   ├── lib/
│   │   │   ├── api.ts          # Axios + todos os tipos de resposta
│   │   │   ├── exportPdf.ts    # Exportação PDF com logo Sentinela (todas as páginas)
│   │   │   └── utils.ts
│   │   └── App.tsx
├── docs/
│   ├── spec.md                 # Especificação funcional
│   ├── logo.svg                # Logo horizontal Sentinela (320×100)
│   ├── logo-icon.svg           # Ícone quadrado Sentinela (64×64)
│   └── adr/                   # Architecture Decision Records
└── docker-compose.yml
```

## Pré-requisitos

- Docker + Docker Compose
- Node.js 20+
- Acesso à rede interna da Ituran (para o Seq e o SQL Server)

## Como rodar

```bash
# 1. Banco de dados
docker compose up -d

# 2. Backend
cd backend
npm install
npm run dev          # porta 3001

# 3. Frontend
cd frontend
npm install
npm run dev          # porta 5173 (proxy /api → :3001)
```

## Variáveis de ambiente (backend)

```env
DATABASE_URL=postgresql://seq_user:seq_pass@localhost:5434/seq_logs
PORT=3001
DD_API_KEY=<datadog-api-key>
DD_APP_KEY=<datadog-application-key>
DD_SITE=us5.datadoghq.com
GC_TOKEN=<gocache-token>
```

> As variáveis `DD_*` e `GC_TOKEN` são lidas no boot do processo — reiniciar o backend após alterar o `.env`.

## API resumida

### Seq / Eventos

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/events` | Listar eventos com filtros |
| GET | `/api/events/stats/summary` | Totais, top erros, top usuários (últimas 4h) |
| GET | `/api/events/stats/timeline` | Timeline por hora/nível |
| GET | `/api/events/stats/empty-guid-timeline` | Timeline de GUID vazio (últimas 4h) |
| GET | `/api/events/stats/auth-errors` | Estatísticas de auth failures (últimas 4h) |
| GET | `/api/events/stats/security` | Findings de segurança (últimas 4h) |
| GET | `/api/events/stats/kong-auth` | Análise Kong Auth — StatusCode != 200 (últimas 4h) |
| POST | `/api/sync` | Sync manual com o Seq |
| POST | `/api/autosync/start` | Iniciar auto-sync (60s) |
| POST | `/api/autosync/stop` | Parar auto-sync |
| GET | `/api/autosync/status` | Status do auto-sync |
| GET | `/api/pessoa/lookup` | Lookup de nomes por user_id |
| GET | `/api/pessoa/stats` | Estatísticas por pessoa |

### Datadog

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/datadog/overview` | Monitores, logs (4h) e hosts |
| GET | `/api/datadog/metrics` | Métricas IIS e SQL Server (última hora via `/api/v1/query`) |

### GoCache WAF

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/gocache/overview` | Resumo WAF/firewall/bot, top IPs/alertas/URIs, eventos recentes (24h) |

## Performance

- **Janela de queries**: todas as rotas de estatísticas consultam apenas as **últimas 4 horas** (`STATS_WINDOW`)
- **Retenção de dados**: o auto-sync deleta eventos com mais de **6 horas** após cada ciclo (`deleteOldEvents`)
- **Sync incremental**: o auto-sync rastreia `newestEventId` e pára a paginação ao atingir o evento já visto — evita re-download completo a cada ciclo
- **Primeira execução**: limitada a eventos das últimas 6h via parâmetro `fromDateUtc` do Seq
- **Índice trigram**: `CREATE INDEX CONCURRENTLY ON seq_events USING GIN (message gin_trgm_ops)` para acelerar buscas `ILIKE`
- **PostgreSQL**: `max_parallel_workers_per_gather = 0` e `max_parallel_workers = 0` para evitar esgotamento de memória compartilhada em WSL

## Exportação PDF

Todas as páginas de análise têm botão **Exportar PDF** no canto superior direito. Os PDFs incluem o logo Sentinela no cabeçalho.

| Página | Função exportada |
|--------|----------------|
| Dashboard | `exportDashboardPdf` |
| GUID Cotação vazio | `exportErrorAnalysisPdf` |
| Falhas de Autenticação | `exportAuthErrorPdf` |
| Kong Auth | `exportKongAuthPdf` |
| Segurança | `exportSecurityPdf` |

Os PDFs usam fonte Helvetica (CP1252) — evitar emoji e símbolos Unicode fora do Latin-1 nos títulos.

## Integrações externas

### Datadog (`us5.datadoghq.com`)

Autenticação via headers `DD-API-KEY` e `DD-APPLICATION-KEY`. Endpoints usados:

- `GET /api/v1/monitor` — estado dos monitores
- `GET /api/v2/logs/events` — volume de logs por serviço (últimas 4h)
- `GET /api/v1/hosts` — lista de hosts ativos
- `GET /api/v1/query` — métricas de série temporal:
  - `iis.net.num_connections{*}by{host}` — conexões ativas IIS
  - `iis.httpd_request_method.{get,post}{*}by{site}` — requisições por site
  - `iis.net.bytes_total{*}by{host}` — throughput por host
  - `iis.errors.not_found{*}by{host}` — taxa de 404
  - `sqlserver.activity.blocked_connections{*}by{host}` — conexões bloqueadas
  - `sqlserver.access.full_scans{*}by{host}` — full table scans/s

> TLS com `rejectUnauthorized: false` — certificado Datadog não é verificável no WSL.

### GoCache WAF

Autenticação via header `GoCache-Token: <token>`. Consultas às últimas 24h:

- Eventos WAF bloqueados (`type=waf`, `action=block`)
- Eventos Firewall bloqueados (`type=firewall`, `action=block`)
- Bots bloqueados (`type=bot-mitigation`, `action=block`)
- Bots em modo monitor (`type=bot-mitigation`, `action=simulate`)

Limite da API: 100 eventos por requisição.

## Notas importantes

- O Seq usa TLS com certificado autoassinado; a verificação é desabilitada intencionalmente (`rejectUnauthorized: false`)
- A autenticação no Seq está desabilitada — o endpoint `/api/events/` funciona sem credenciais
- O auto-sync corre a cada 60s com sync incremental — apenas novos eventos são baixados após a primeira execução
- O `user_id` nos eventos do `salesbo` é um `cd_pessoa` numérico que mapeia para `pessoa.nm_pessoa` no banco `ituranweb`
- Propriedades JSONB do Kong (StatusCode, Username, ClientIp, Path) são extraídas via subquery `jsonb_array_elements` no CTE
- As métricas Datadog disponíveis neste ambiente são de infraestrutura Windows (IIS, SQL Server) — não há métricas `system.cpu.*` (agente sem acesso a métricas de host)
