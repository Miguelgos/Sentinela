# Arquitetura — Visão Geral

## Stack

| Camada | Tecnologia atual | Alvo (pós-refactor) |
|--------|-----------------|---------------------|
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui | Mantém + TanStack Start |
| Backend | Node.js + Express + TypeScript | TanStack Start (Nitro) |
| Storage | SQLite (`better-sqlite3`) + Map in-memory | Map in-memory; cursor opcional em dev |
| Charts | Recharts cru | shadcn/ui charts (Recharts wrapped) |
| Tabelas | Manual | TanStack Table |
| Estado | `useState` + `useEffect` | TanStack Query |
| LLM | Anthropic API direta (`geminiClient.ts`) | `openai` SDK → Azure OpenAI Foundry |
| PDF export | jsPDF + jspdf-autotable | jsPDF deduplicado |
| HTTP interno | `https` nativo Node (TLS sem verificação) | Helper único `lib/http.ts` |

## Componentes principais

```
seq-analyzer/
├── backend/src/
│   ├── accumulator.ts       # Seq polling + Map in-memory
│   ├── seq.ts               # Seq HTTP client
│   ├── types.ts             # Parsers de evento
│   ├── lib/
│   │   ├── ddClient.ts      # Datadog HTTP client
│   │   ├── gcClient.ts      # GoCache HTTP client
│   │   ├── grafanaClient.ts # Grafana/Prometheus client
│   │   ├── lokiClient.ts    # Grafana/Loki client
│   │   └── geminiClient.ts  # Azure OpenAI client (nome histórico)
│   ├── db/
│   │   ├── sqlite.ts        # SQLite (removido na Fase 1)
│   │   └── mssql.ts         # SQL Server lookup
│   └── routes/              # Express routers
└── frontend/src/
    ├── components/          # 15 componentes de tela
    ├── lib/api.ts           # HTTP client do frontend
    └── lib/exportPdf.ts     # Geração de PDFs
```

## Fluxo de dados principal

```
Seq (polling 60s)
  → accumulator.ts (Map in-memory, janela 7d)
    → routes/events.ts (stats, timeline, security, kong-auth)
      → frontend components
        → exportPdf.ts (jsPDF, download)

Datadog / GoCache / Grafana
  → routes/datadog.ts / gocache.ts / grafana.ts / audit.ts
    → frontend components (DatadogAnalysis, GoCacheAnalysis, etc.)

routes/report.ts
  → Coleta dados das 3 fontes (Seq + Datadog + GoCache)
  → 15 regras de correlação
  → Azure OpenAI Foundry (narrativa executiva)
    → ReportAnalysis.tsx → exportThreatReportPdf
```

## Decisões de arquitetura

Os ADRs estão em [`docs/adr/`](../adr/) e cobrem:
- ADR-001 a ADR-005: banco de dados (PostgreSQL → SQLite → in-memory)
- ADR-006/010: ciclos de sincronização
- ADR-007: stack frontend (React + shadcn)
- ADR-008: extração por regex
- ADR-009: SSL autoassinado
- ADR-011 a ADR-014: LLM, GoCache, Datadog, PDF
