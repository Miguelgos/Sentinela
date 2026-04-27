# Arquitetura — Visão Geral

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Servidor | TanStack Start v1 (Vite SSR, basepath `/sentinela`) |
| Frontend | React 19 + TypeScript + Tailwind CSS + shadcn/ui |
| Autenticação | Supabase Auth — Microsoft Azure AD (OAuth 2.0) + email/senha |
| Store | Map in-memory (`accumulator.ts`) — janela 7d, cap 50k, só Warning/Error/Fatal |
| Charts | Recharts via shadcn/ui charts |
| Tabelas | TanStack Table |
| Estado | TanStack Query |
| LLM | Azure OpenAI Foundry (`aiClient.ts`, deployment `sentinela`) |
| PDF export | jsPDF + jspdf-autotable |
| HTTP interno | `https` nativo Node (TLS sem verificação) |
| Banco auxiliar | SQL Server (`mssql.ts`) — lookup de `nm_pessoa` |

## Componentes principais

```
seq-analyzer/
├── app/
│   ├── server.tsx           # SSR entry + init accumulator
│   ├── router.tsx           # getRouter() — TanStack Router
│   ├── client.tsx           # hydrateRoot()
│   └── server/fn/           # Server functions
│       ├── events.ts        # Seq stats, auth errors, kong auth
│       ├── grafana.ts       # Kubernetes (Prometheus)
│       ├── datadog.ts       # Monitores, métricas, infra
│       ├── gocache.ts       # WAF, bot, firewall
│       ├── report.ts        # 14 regras + Azure OpenAI
│       ├── audit.ts         # Auditoria (Loki) — unmasked data, nm_pessoa
│       └── pessoa.ts        # nm_pessoa (SQL Server)
├── backend/src/
│   ├── accumulator.ts       # Seq polling + Map in-memory (filtro: Warning/Error/Fatal + signal)
│   ├── seq.ts               # Seq HTTP client (sem signal — rotas usam filtros próprios)
│   ├── lib/
│   │   ├── aiClient.ts      # Azure OpenAI client
│   │   ├── ddClient.ts      # Datadog HTTP client
│   │   ├── gcClient.ts      # GoCache HTTP client
│   │   ├── grafanaClient.ts # Grafana/Prometheus client
│   │   └── lokiClient.ts    # Grafana/Loki client
│   └── db/
│       └── mssql.ts         # SQL Server lookup (lazy config — lê .env no connect)
└── frontend/src/
    ├── components/          # 9 componentes de tela + LoginPage
    ├── hooks/useAuth.ts     # Supabase Auth (Microsoft OAuth + email/senha)
    ├── lib/supabase.ts      # Supabase browser client
    ├── lib/api.ts           # Wrappers de server functions + tipos
    └── lib/exportPdf.ts     # Geração de PDFs (4 exportações)
```

## Fluxo de dados principal

```
Supabase Auth (Microsoft Azure AD / email)
  → useAuth.ts → LoginPage.tsx (tela de login)
    → App.tsx (guarda dashboard se sem sessão)

Seq (polling 60s, filtro: Warning/Error/Fatal + signal-m33301~signal-m33302)
  → accumulator.ts (Map in-memory, cap 50k, janela 7d)
    → app/server/fn/events.ts (stats, timeline, auth, kong)
      → componentes React
        → exportPdf.ts (jsPDF, download)

Datadog / GoCache / Grafana / Loki
  → app/server/fn/{datadog,gocache,grafana,audit}.ts
    → componentes (DatadogAnalysis, GoCacheAnalysis, KubernetesAnalysis, AuditAnalysis)

SQL Server (banco espelho)
  → app/server/fn/pessoa.ts
    → Dashboard, LogsTable, AuditAnalysis (exibe nm_pessoa)

app/server/fn/report.ts
  → Coleta dados das 5 fontes (Seq + Datadog + GoCache + Grafana + Loki auditoria)
  → 15 regras de correlação (ecossistema completo integra-prd)
  → Azure OpenAI (narrativa executiva genérica — sem referência a serviço específico)
    → ReportAnalysis.tsx → exportThreatReportPdf
```

## Decisões de arquitetura

Os ADRs estão em [`docs/adr/`](../adr/) e cobrem:
- ADR-001 a ADR-005: evolução do banco de dados (PostgreSQL → SQLite → in-memory)
- ADR-006/010: ciclos de sincronização e acumulador
- ADR-007: stack frontend (React + shadcn)
- ADR-008: extração por regex
- ADR-009: SSL autoassinado
- ADR-010: SQLite removido; store purely in-memory
- ADR-011: Relatório de Ameaças (evolução Gemini → Claude → Azure OpenAI)
- ADR-012 a ADR-014: GoCache, Datadog, PDF logo
