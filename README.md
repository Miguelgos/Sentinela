# Sentinela

Dashboard web de inteligência de logs e segurança para o serviço `salesbo` da Ituran, ambiente `integra-prd`.

## Contexto

O **Sentinela** monitora em tempo real os eventos do serviço `salesbo` (Sales Backoffice) publicados no Seq em `https://seq-prd.ituran.sp`. Consome esses eventos via polling contínuo e mantém uma store in-memory para consultas rápidas. As análises cobrem os seguintes padrões:

1. **GUID de Cotação vazio** — endpoint `Quote/PrintItens` chamado com `GUID_COTACAO: 00000000-0000-0000-0000-000000000000`
2. **Falhas de autenticação** — endpoint `/connect/token` com fluxo ResourceOwner retornando `Unauthorized`
3. **Kong Auth Request com falhas** — requisições via Kong com `StatusCode != 200`
4. **Análise de Segurança** — findings de segurança com severidade (Critical/High/Medium/Low)
5. **Datadog** — monitores, logs, hosts, SLOs, downtimes, incidentes, métricas IIS, SQL Server e infra
6. **GoCache WAF** — eventos WAF, firewall, bot mitigation, categorias de ataque, países, ferramentas ofensivas
7. **Kubernetes / JobScheduler** — métricas Prometheus via Grafana (`grafana-prd.ituran.sp`)
8. **Auditoria** — logs do `integra-audit` via Loki/Grafana (~140k eventos/24h)
9. **Relatório de Ameaças** — 15 regras de correlação cruzada (Seq + Datadog + GoCache + Grafana) + narrativa Azure OpenAI

## Documentação

> A documentação foi reorganizada em `docs/` na Fase 9. O arquivo `docs/spec.md` foi mantido
> para compatibilidade; a estrutura canônica está nos diretórios abaixo.

| Diretório | Conteúdo |
|-----------|----------|
| [`docs/architecture/`](docs/architecture/) | Visão geral, modelo de dados, polling do Seq, integrações |
| [`docs/specs/`](docs/specs/) | Spec de cada página (Dashboard, Auditoria, Kubernetes, etc.) |
| [`docs/deploy/`](docs/deploy/) | Deploy em Kubernetes (cluster-bra-prd, namespace integra-prd) |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records (ADR-001 a ADR-014) |
| [`docs/refactor-plan.md`](docs/refactor-plan.md) | Plano de simplificação (Fases 1-9) |

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| Backend | Node.js + Express + TypeScript |
| Banco principal | SQLite (`better-sqlite3`, arquivo `data/events.db`) |
| Store in-memory | Map em `accumulator.ts` para consultas rápidas |
| Banco auxiliar | SQL Server (`ituranweb` — lookup de nomes de pessoa) |
| Gráficos | Recharts |
| PDF export | jsPDF + jspdf-autotable |
| HTTP (interno) | `https` nativo do Node (TLS sem verificação de certificado) |
| Monitoramento externo | Datadog (us5.datadoghq.com) + GoCache WAF API |
| IA generativa | Claude Haiku 4.5 — Anthropic API (narrativa do Relatório de Ameaças) |

## Estrutura

```
seq-analyzer/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── sqlite.ts        # better-sqlite3 (tier A/B retention)
│   │   │   └── mssql.ts         # SQL Server lookup
│   │   ├── lib/
│   │   │   ├── ddClient.ts      # Datadog HTTP client
│   │   │   ├── gcClient.ts      # GoCache HTTP client
│   │   │   └── geminiClient.ts  # Anthropic Claude client (nome histórico)
│   │   ├── routes/
│   │   │   ├── events.ts        # Seq events CRUD + stats
│   │   │   ├── pessoa.ts        # Nome lookup
│   │   │   ├── datadog.ts       # Datadog overview + metrics + infra
│   │   │   ├── gocache.ts       # GoCache WAF + bot + firewall
│   │   │   └── report.ts        # Relatório de Ameaças (12 regras + Claude)
│   │   ├── accumulator.ts       # Seq polling + in-memory store + SQLite write-through
│   │   ├── seq.ts               # Seq HTTP client
│   │   ├── types.ts             # Event parsers
│   │   └── index.ts             # Express entry point
├── frontend/
│   ├── public/
│   │   └── sentinela_v1_radar_pulso.svg   # Logo Sentinela (800x320)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   ├── SentinelaLogo.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── LogsTable.tsx
│   │   │   ├── ErrorAnalysis.tsx
│   │   │   ├── AuthErrorAnalysis.tsx
│   │   │   ├── KongAuthAnalysis.tsx
│   │   │   ├── SecurityAnalysis.tsx
│   │   │   ├── DatadogAnalysis.tsx
│   │   │   ├── GoCacheAnalysis.tsx
│   │   │   ├── ReportAnalysis.tsx         # Relatório de Ameaças
│   │   │   ├── SyncConfig.tsx
│   │   │   └── EventDetail.tsx
│   │   ├── lib/
│   │   │   ├── api.ts
│   │   │   ├── exportPdf.ts      # PDF export com SVG logo rasterizado via Canvas
│   │   │   └── utils.ts
│   │   └── App.tsx
├── docs/
│   ├── spec.md
│   ├── logo.svg
│   ├── logo-icon.svg
│   └── adr/
└── docker-compose.yml             # legado — não necessário para o banco de dados
```

## Pré-requisitos

- Node.js 20+
- Acesso à rede interna da Ituran (para o Seq e o SQL Server)

> Não é necessário Docker para o banco de dados. O SQLite é um arquivo local em `data/events.db`.

## Como rodar

```bash
# Backend
cd backend
npm install
npm run dev   # porta 3001

# Frontend
cd frontend
npm install
npm run dev   # porta 5173 (proxy /api -> :3001)
```

## Variáveis de ambiente (backend `.env`)

```env
PORT=3001
SEQ_URL=https://seq-prd.ituran.sp
SEQ_SIGNAL=signal-m33301
SQLITE_PATH=./data/events.db
DD_API_KEY=<datadog-api-key>
DD_APP_KEY=<datadog-application-key>
DD_SITE=us5.datadoghq.com
GC_TOKEN=<gocache-token>
MSSQL_SERVER=<server>
MSSQL_DATABASE=ituranweb
MSSQL_USER=<user>
MSSQL_PASSWORD=<password>
ANTHROPIC_API_KEY=<anthropic-api-key>
```

> Todas as variáveis são lidas no boot do processo — reiniciar o backend após alterar o `.env`.

## API

### Seq / Eventos

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/events` | Listar eventos com filtros |
| GET | `/api/events/:id` | Detalhe de um evento |
| GET | `/api/events/stats/summary` | Totais, top erros, top usuários (últimas 4h) |
| GET | `/api/events/stats/timeline` | Timeline por hora/nível |
| GET | `/api/events/stats/empty-guid-timeline` | Timeline de GUID vazio (últimas 4h) |
| GET | `/api/events/stats/auth-errors` | Estatísticas de auth failures (últimas 4h) |
| GET | `/api/events/stats/security` | Findings de segurança (últimas 4h) |
| GET | `/api/events/stats/kong-auth` | Análise Kong Auth — StatusCode != 200 (últimas 4h) |

### Pessoa

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/pessoa/lookup` | Lookup de nomes por user_id |
| GET | `/api/pessoa/stats` | Estatísticas por pessoa |

### Datadog

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/datadog/overview` | Monitores, logs, hosts, SLOs, downtimes ativos e incidentes ativos |
| GET | `/api/datadog/metrics` | Métricas IIS e SQL Server (última hora) |
| GET | `/api/datadog/infra` | CPU, memória, disco, rede, restarts de pods K8s, CPU de containers |

### GoCache WAF

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/gocache/overview` | WAF + bot + firewall + categorias de ataque + países + timeline + ferramentas |

### Relatório de Ameaças

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/report/threat` | 12 regras de correlação cruzada + narrativa Claude (Anthropic) |

### Health

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Status do serviço |

## Regras de correlação do Relatório de Ameaças

O endpoint `/api/report/threat` cruza dados de Seq, Datadog e GoCache com 12 regras:

| Regra | Descrição |
|-------|-----------|
| `BRUTE_FORCE` | Tentativas de brute force detectadas nos logs de autenticação |
| `ANOMALOUS_USERNAMES` | Usernames em formato anômalo (ex.: CNPJ como login) |
| `WAF_INJECTION` | Ataques de injeção bloqueados pelo WAF (SQLi, XSS) |
| `MULTI_SOURCE_IP` | Mesmo usuário acessando de múltiplos IPs simultâneos |
| `EXPIRED_CERTS` | Certificados SSL/TLS expirados em uso em produção |
| `DATADOG_ALERT` | Monitores Datadog em estado Alert ou Warn |
| `HIGH_ERROR_RATE` | Taxa de erros acima do limiar esperado |
| `ACTIVE_INCIDENT` | Incidentes ativos registrados no Datadog |
| `SCANNER_DETECTED` | Scanners de vulnerabilidade detectados (Nikto, SQLMap, etc.) |
| `BOT_ATTACK` | Bots maliciosos bloqueados pelo GoCache |
| `INFRA_STRESS` | CPU, memória ou disco de hosts em nível crítico |
| `GEO_CONCENTRATION` | Concentração anômala de ataques em um único país |

A narrativa executiva é gerada pelo Claude Haiku 4.5 (Anthropic) com ~400 palavras em 4 seções estruturadas: Resumo Executivo, Ameaças Prioritárias, Recomendações Imediatas e Avaliação de Risco. Em caso de indisponibilidade da API, um resumo estático é retornado como fallback.

## Exportação PDF

Todas as páginas de análise têm botão **Exportar PDF** no canto superior direito. O logo SVG (`sentinela_v1_radar_pulso.svg`) é rasterizado via Canvas API no carregamento do módulo e embutido como PNG em todos os cabeçalhos de PDF.

| Página | Função exportada |
|--------|----------------|
| Dashboard | `exportDashboardPdf` |
| GUID Cotação vazio | `exportErrorAnalysisPdf` |
| Falhas de Autenticação | `exportAuthErrorPdf` |
| Kong Auth | `exportKongAuthPdf` |
| Segurança | `exportSecurityPdf` |
| Relatório de Ameaças | `exportThreatReportPdf` |

## Integrações externas

### Seq (`https://seq-prd.ituran.sp`)

- TLS com certificado autoassinado — verificação desabilitada intencionalmente (`rejectUnauthorized: false`)
- Autenticação desabilitada — endpoint público sem credenciais
- Filtro por signal: `signal-m33301` (apenas erros)
- Polling contínuo via `accumulator.ts`; eventos persistidos em SQLite com tiered retention

### Datadog (`api.us5.datadoghq.com`)

Autenticação via headers `DD-API-KEY` e `DD-APPLICATION-KEY`. Endpoints usados:

- `GET /api/v1/monitor` — estado dos monitores
- `GET /api/v2/logs/events` — volume de logs por serviço (últimas 4h)
- `GET /api/v1/hosts` — lista de hosts ativos
- `GET /api/v1/slo` — SLOs e limiares
- `GET /api/v1/downtime` — downtimes ativos
- `GET /api/v2/incidents` — incidentes ativos
- `GET /api/v1/query` — métricas de série temporal (IIS, SQL Server, infra)

### GoCache (`api.gocache.com.br`)

Autenticação via header `GoCache-Token: <token>`. Consultas às últimas 24h com paginação (até 500 eventos WAF, 300 bot via parâmetro `page`):

- Eventos WAF bloqueados com classificação de categoria: SQLi, XSS, PathTraversal, Scanner, Protocol, Other
- Eventos Firewall bloqueados
- Bots bloqueados e em modo monitor
- Detecção de ferramentas ofensivas: SQLMap, Nikto, Dart, Python, curl, Go, Java, Headless

### Anthropic Claude (`api.anthropic.com`)

- Model: `claude-haiku-4-5-20251001`
- Endpoint: `POST /v1/messages`
- Autenticação: header `x-api-key: ANTHROPIC_API_KEY` + `anthropic-version: 2023-06-01`
- Usado exclusivamente para a narrativa executiva do Relatório de Ameaças
- Fallback automático para resumo estático se API indisponível ou bloqueada

> `generativelanguage.googleapis.com` (Gemini) está bloqueado pelo Forcepoint na rede corporativa Ituran. `api.anthropic.com` está acessível.

### SQL Server (`ituranweb`)

- Driver `mssql`
- Lookup de `nm_pessoa` por `cd_pessoa` (campo `user_id` dos eventos do salesbo)
