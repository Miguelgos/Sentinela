# Sentinela

Dashboard web de inteligência de logs para o serviço `salesbo` da Ituran, ambiente `integra-prd`.

## Contexto

O **Sentinela** monitora em tempo real os eventos do serviço `salesbo` (Sales Backoffice) publicados no Seq em `https://seq-prd.ituran.sp`. Consome esses eventos, persiste localmente em PostgreSQL e fornece análises focadas nos seguintes padrões:

1. **GUID de Cotação vazio** — endpoint `Quote/PrintItens` chamado com `GUID_COTACAO: 00000000-0000-0000-0000-000000000000`
2. **Falhas de autenticação** — endpoint `/connect/token` com fluxo ResourceOwner retornando `Unauthorized`
3. **Kong Auth Request com falhas** — requisições via Kong com `StatusCode != 200`
4. **Análise de Segurança** — findings de segurança com severidade (Critical/High/Medium/Low)

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
│   │   │   └── pessoa.ts       # Lookup de nomes
│   │   ├── autosync.ts         # Módulo de auto-sync incremental com retenção
│   │   ├── sync-core.ts        # Funções compartilhadas de sync + deleteOldEvents
│   │   ├── types.ts            # Parsers e tipos
│   │   └── index.ts            # Entry point + bootstrap
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                    # Primitivos shadcn/ui
│   │   │   ├── Dashboard.tsx          # Dashboard principal
│   │   │   ├── LogsTable.tsx          # Tabela de eventos
│   │   │   ├── ErrorAnalysis.tsx      # Análise GUID vazio
│   │   │   ├── AuthErrorAnalysis.tsx  # Análise auth failures
│   │   │   ├── KongAuthAnalysis.tsx   # Análise Kong Auth (StatusCode != 200)
│   │   │   ├── SecurityAnalysis.tsx   # Análise de segurança (findings)
│   │   │   ├── SyncConfig.tsx         # Configuração de sync
│   │   │   └── EventDetail.tsx        # Modal de detalhe de evento
│   │   ├── lib/
│   │   │   ├── api.ts          # Axios + todos os tipos de resposta
│   │   │   ├── exportPdf.ts    # Exportação PDF (todas as páginas)
│   │   │   └── utils.ts
│   │   └── App.tsx
├── docs/
│   ├── spec.md                 # Especificação funcional
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
DATABASE_URL=postgresql://seq_user:seq_pass@localhost:5434/seq_analyzer
PORT=3001
```

## API resumida

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

## Performance

- **Janela de queries**: todas as rotas de estatísticas consultam apenas as **últimas 4 horas** (`STATS_WINDOW`)
- **Retenção de dados**: o auto-sync deleta eventos com mais de **6 horas** após cada ciclo (`deleteOldEvents`)
- **Sync incremental**: o auto-sync rastreia `newestEventId` e pára a paginação ao atingir o evento já visto — evita re-download completo a cada ciclo
- **Primeira execução**: limitada a eventos das últimas 6h via parâmetro `fromDateUtc` do Seq
- **Índice trigram**: `CREATE INDEX CONCURRENTLY ON seq_events USING GIN (message gin_trgm_ops)` para acelerar buscas `ILIKE`
- **PostgreSQL**: `max_parallel_workers_per_gather = 0` e `max_parallel_workers = 0` para evitar esgotamento de memória compartilhada em WSL

## Exportação PDF

Todas as páginas de análise têm botão **Exportar PDF** no canto superior direito:

| Página | Função exportada |
|--------|----------------|
| Dashboard | `exportDashboardPdf` |
| GUID Cotação vazio | `exportErrorAnalysisPdf` |
| Falhas de Autenticação | `exportAuthErrorPdf` |
| Kong Auth | `exportKongAuthPdf` |
| Segurança | `exportSecurityPdf` |

Os PDFs usam fonte Helvetica (CP1252) — evitar emoji e símbolos Unicode fora do Latin-1 nos títulos.

## Notas importantes

- O Seq usa TLS com certificado autoassinado; a verificação é desabilitada intencionalmente (`rejectUnauthorized: false`)
- A autenticação no Seq está desabilitada — o endpoint `/api/events/` funciona sem credenciais
- O auto-sync corre a cada 60s com sync incremental — apenas novos eventos são baixados após a primeira execução
- O `user_id` nos eventos do `salesbo` é um `cd_pessoa` numérico que mapeia para `pessoa.nm_pessoa` no banco `ituranweb`
- Propriedades JSONB do Kong (StatusCode, Username, ClientIp, Path) são extraídas via subquery `jsonb_array_elements` no CTE
