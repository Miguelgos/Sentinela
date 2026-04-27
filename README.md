# Sentinela

Dashboard web de inteligência de logs e segurança para o serviço `salesbo` da Ituran, ambiente `integra-prd`.

## Contexto

O **Sentinela** monitora em tempo real os eventos do serviço `salesbo` (Sales Backoffice) publicados no Seq em `https://seq-prd.ituran.sp`. Consome esses eventos via polling contínuo e mantém uma store in-memory para consultas rápidas. As análises cobrem os seguintes padrões:

1. **Falhas de autenticação** — endpoint `/connect/token` com fluxo ResourceOwner retornando `Unauthorized`
2. **Kong Auth Request com falhas** — requisições via Kong com `StatusCode != 200`
3. **Datadog** — monitores, logs, hosts, SLOs, downtimes, incidentes, métricas IIS, SQL Server e infra
4. **GoCache WAF** — eventos WAF, firewall, bot mitigation, categorias de ataque, países, ferramentas ofensivas
5. **Kubernetes** — métricas Prometheus via Grafana (`grafana-prd.ituran.sp`)
6. **Auditoria** — logs do `integra-audit` via Loki/Grafana (~140k eventos/24h), com lookup de `nm_pessoa` no banco espelho
7. **Relatório de Ameaças** — 14 regras de correlação cruzada (Seq + Datadog + GoCache + Grafana) + narrativa Azure OpenAI

## Documentação

| Diretório | Conteúdo |
|-----------|----------|
| [`docs/architecture/`](docs/architecture/) | Visão geral, modelo de dados, polling do Seq, integrações |
| [`docs/specs/`](docs/specs/) | Spec de cada página (Dashboard, Auditoria, Kubernetes, etc.) |
| [`docs/deploy/`](docs/deploy/) | Deploy em Kubernetes (cluster-bra-prd, namespace integra-prd) |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records (ADR-001 a ADR-014) |

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Servidor | TanStack Start v1 (Vite + SSR) |
| Frontend | React 19 + TypeScript + Tailwind CSS + shadcn/ui |
| Autenticação | Supabase Auth — Microsoft Azure AD (OAuth 2.0) + email/senha |
| Store in-memory | Map em `accumulator.ts` — janela 7d, cap 50k eventos (só Warning/Error/Fatal) |
| Banco auxiliar | SQL Server (`ituranweb` — lookup de `nm_pessoa`) |
| Gráficos | Recharts via shadcn/ui charts |
| Tabelas | TanStack Table |
| Estado assíncrono | TanStack Query |
| PDF export | jsPDF + jspdf-autotable |
| IA generativa | Azure OpenAI (deployment `sentinela`) — narrativa do Relatório de Ameaças |
| HTTP (interno) | `https` nativo Node (TLS sem verificação de certificado) |
| Monitoramento externo | Datadog (us5.datadoghq.com) + GoCache WAF API + Grafana/Prometheus + Loki |

## Estrutura

```
seq-analyzer/
├── app/
│   ├── client.tsx           # Hydration entry point
│   ├── router.tsx           # TanStack Router (getRouter)
│   ├── server.tsx           # SSR entry point + init do accumulator
│   └── routes/
│       ├── __root.tsx       # Layout raiz (dark mode, QueryClientProvider, favicon)
│       └── index.tsx        # Redirect para /sentinela/
│   └── server/fn/           # Server functions (TanStack Start)
│       ├── events.ts        # Stats, timeline, auth errors, kong auth
│       ├── grafana.ts       # Kubernetes (Prometheus)
│       ├── datadog.ts       # Monitores, métricas, infra
│       ├── gocache.ts       # WAF, bot, firewall
│       ├── report.ts        # Relatório de Ameaças (14 regras + Azure OpenAI)
│       ├── audit.ts         # Auditoria via Loki (unmasked data, nm_pessoa)
│       └── pessoa.ts        # Lookup nm_pessoa (SQL Server)
├── backend/
│   └── src/
│       ├── accumulator.ts   # Seq polling + Map in-memory (cap 50k, só Warning/Error/Fatal)
│       ├── seq.ts           # Seq HTTP client (signal + level filter)
│       ├── lib/
│       │   ├── aiClient.ts      # Azure OpenAI client
│       │   ├── ddClient.ts      # Datadog HTTP client
│       │   ├── gcClient.ts      # GoCache HTTP client
│       │   ├── grafanaClient.ts # Grafana/Prometheus client
│       │   └── lokiClient.ts    # Grafana/Loki client
│       └── db/
│           └── mssql.ts     # SQL Server lookup (nm_pessoa, lazy config)
├── frontend/
│   ├── public/
│   │   ├── favicon.svg          # Favicon radar (gerado nesta sessão)
│   │   └── sentinela_v1_radar_pulso.svg
│   └── src/
│       ├── components/
│       │   ├── Dashboard.tsx
│       │   ├── LogsTable.tsx
│       │   ├── AuthErrorAnalysis.tsx
│       │   ├── KongAuthAnalysis.tsx
│       │   ├── DatadogAnalysis.tsx
│       │   ├── GoCacheAnalysis.tsx
│       │   ├── ReportAnalysis.tsx
│       │   ├── KubernetesAnalysis.tsx
│       │   ├── AuditAnalysis.tsx
│       │   ├── LoginPage.tsx        # Tela de login (Supabase Auth)
│       │   └── EventDetail.tsx
│       ├── hooks/
│       │   └── useAuth.ts       # Hook de sessão Supabase (Microsoft OAuth + email/senha)
│       └── lib/
│           ├── api.ts           # Server function wrappers + tipos
│           ├── supabase.ts      # Supabase browser client
│           ├── exportPdf.ts     # PDF export com logo SVG via Canvas
│           └── utils.ts
├── .env                     # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── vite.config.ts           # TanStack Start config (basepath /sentinela, CSP headers)
└── docs/
```

## Como rodar

```bash
# Instalar dependências (raiz do projeto)
npm install

# Backend (accumulator + Express — porta 3001)
cd backend && npm run dev

# Servidor TanStack Start (porta 5173, path /sentinela)
cd ..
npm run dev
```

> O acumulador filtra o Seq para `Warning/Error/Fatal` com o signal `signal-m33301~signal-m33302`, sincronizando apenas eventos relevantes (~1 min na inicialização).

## Variáveis de ambiente

### `.env` (raiz — frontend)

```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

### `backend/.env`

```env
PORT=3001
SEQ_URL=https://seq-prd.ituran.sp
SEQ_SIGNAL=signal-m33301~signal-m33302   # signal do Seq para filtrar apps relevantes
DD_API_KEY=<datadog-api-key>
DD_APP_KEY=<datadog-application-key>
DD_SITE=us5.datadoghq.com
GC_TOKEN=<gocache-token>
GRAFANA_URL=http://grafana-prd.ituran.sp
GRAFANA_TOKEN=<grafana-token>
MSSQL_SERVER=BRSPO1IDB11.ITURAN.SP   # opcional — default hardcoded
MSSQL_INSTANCE=INTEGRA_ESPELHO        # opcional — default hardcoded
MSSQL_DATABASE=ituranweb              # opcional — default hardcoded
MSSQL_USER=<user>
MSSQL_PASSWORD=<password>
AZURE_OPENAI_ENDPOINT=<endpoint>
AZURE_OPENAI_KEY=<api-key>
AZURE_OPENAI_DEPLOYMENT=sentinela
```

> As credenciais MSSQL são lidas no momento da conexão (lazy) — não requer reinício para alterações nessas variáveis.

## Regras de correlação do Relatório de Ameaças

O servidor `app/server/fn/report.ts` cruza dados de Seq, Datadog, GoCache e Grafana com 14 regras:

| Regra | Descrição |
|-------|-----------|
| `BRUTE_FORCE` | ≥5 falhas de autenticação em janela de 10 min por usuário |
| `WAF_INJECTION` | Ataques SQLi/XSS bloqueados pelo WAF GoCache |
| `MULTI_SOURCE_IP` | IPs presentes tanto no GoCache quanto nos logs do Seq |
| `DATADOG_ALERT` | Monitores Datadog em estado Alert ou Warn |
| `HIGH_ERROR_RATE` | >50 eventos Error/Critical na última hora |
| `ACTIVE_INCIDENT` | Incidentes não resolvidos no Datadog |
| `SCANNER_DETECTED` | Ferramentas ofensivas (SQLMap, Nikto, Dart) detectadas no WAF |
| `BOT_ATTACK` | >100 bloqueios de bots em 24h |
| `INFRA_STRESS` | CPU >85%, disco >90% ou reinicializações de pods |
| `GEO_CONCENTRATION` | Concentração de ataques em países de alto risco (CN, RU, KP, IR) |
| `PROMETHEUS_ALERT` | Alertas críticos ou >3 warnings no Alertmanager/Grafana |
| `DEPLOYMENT_DOWN` | Deployments com 0 réplicas no namespace `integra-prd` |

A narrativa executiva (~400 palavras, 4 seções) é gerada pelo Azure OpenAI (deployment `sentinela`). Em caso de indisponibilidade, um resumo estático dos achados é retornado como fallback.

## Exportação PDF

Páginas com botão **Exportar PDF**:

| Página | Função |
|--------|--------|
| Dashboard | `exportDashboardPdf` |
| Falhas de Autenticação | `exportAuthErrorPdf` |
| Kong Auth | `exportKongAuthPdf` |
| Relatório de Ameaças | `exportThreatReportPdf` |

O logo SVG é rasterizado via Canvas API no carregamento do módulo e embutido como PNG em todos os cabeçalhos.

## Integrações externas

### Seq (`https://seq-prd.ituran.sp`)
- TLS com certificado autoassinado — `rejectUnauthorized: false`
- Sem autenticação — endpoint público
- Polling contínuo via `accumulator.ts`; janela de 7 dias, cap de 50k eventos

### Datadog (`api.us5.datadoghq.com`)
Autenticação via headers `DD-API-KEY` e `DD-APPLICATION-KEY`.

### GoCache (`api.gocache.com.br`)
Autenticação via header `GoCache-Token`. Consultas às últimas 24h.

### Grafana (`grafana-prd.ituran.sp`)
- Prometheus (PromQL) — métricas de pods, deployments, alertas
- Loki — logs de auditoria dos serviços `integra-audit`, `customer360`, `fieldservice`

### Azure OpenAI
- Endpoint: `AZURE_OPENAI_ENDPOINT` (Azure Foundry interno da Ituran)
- Deployment: `sentinela`
- Autenticação: header `api-key`
- Usado exclusivamente para a narrativa do Relatório de Ameaças
- Fallback automático se API indisponível

### SQL Server (`ituranweb` — banco espelho)
- Instância: `BRSPO1IDB11.ITURAN.SP\INTEGRA_ESPELHO`
- Query: `SELECT cd_pessoa, nm_pessoa FROM pessoa WHERE cd_pessoa IN (...)`
- Usado para exibir nomes nas páginas de Dashboard, Eventos, Auditoria
