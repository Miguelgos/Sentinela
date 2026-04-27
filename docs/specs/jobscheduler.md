# Spec — JobScheduler (Grafana/Prometheus)

**Rota interna:** `jobscheduler`
**Componente:** `JobSchedulerAnalysis.tsx`
**Endpoint backend:** `GET /api/grafana/jobscheduler`
**PDF:** não tem

## Contexto

A página JobScheduler consulta métricas de jobs agendados (Hangfire) no namespace
`integra-prd` via Prometheus, acessado pelo datasource proxy do Grafana interno.
Datasource UID: `prometheus`.

## Funcionalidades

### Cards de totais

- Total de execuções de jobs
- Total de falhas
- Taxa de erro geral (%)
- Duração média de execução

### Por provider/job

Para cada provider de job identificado:

- Total de execuções
- Total de falhas
- Taxa de erro (%)
- Duração média em ms (formatada: `Xs` se >= 1000ms, `Xms` caso contrário)

Cor da taxa de erro: verde (< 1%), amarelo (1-10%), vermelho (> 10%).

### Timeline

Gráfico de barras agrupado por hora: execuções vs. falhas.

### Jobs com maior taxa de falha

Ranking dos jobs com pior desempenho (top N).

## Integração técnica

- Tipos: `GrafanaJobScheduler`, `GrafanaProvider` em `frontend/src/lib/api.ts`
- Cliente: `backend/src/lib/grafanaClient.ts` (`grafanaPromQuery`)
- Rota: `backend/src/routes/grafana.ts` handler `/jobscheduler`
- Auth: `Authorization: Bearer ${GRAFANA_TOKEN}`
- Tolerante a falha: `Promise.allSettled` — retorna dados parciais

## Relação com o Relatório de Ameaças

Rule 15 (`JOBSCHEDULER_ERRORS`) no `routes/report.ts` usa dados desta rota para
detectar jobs Hangfire com taxa de falha acima do limiar — correlacionado com SEC-015.
