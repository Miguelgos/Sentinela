# Integrações Externas

Resumo de todas as integrações consumidas pelo Sentinela. Detalhes de cada endpoint
estão em `docs/specs/` nas páginas e integrações correspondentes.

## Seq (`https://seq-prd.ituran.sp`)

- TLS com certificado autoassinado — `rejectUnauthorized: false` (apenas para Seq)
- Sem autenticação — endpoint público
- Filtro: `signal-m33301` (apenas erros do salesbo)
- Polling via `accumulator.ts`; ver `docs/architecture/seq-polling.md`

## Datadog (`api.us5.datadoghq.com`)

- Auth: headers `DD-API-KEY` e `DD-APPLICATION-KEY`
- Endpoints: monitores, logs, hosts, SLOs, downtimes, incidentes, métricas (IIS, SQL, infra)
- Rotas backend: `GET /api/datadog/overview`, `/api/datadog/metrics`, `/api/datadog/infra`

## GoCache (`api.gocache.com.br`)

- Auth: header `GoCache-Token: <token>`
- Consultas às últimas 24h com paginação (até 500 eventos WAF, 300 bot)
- Rota backend: `GET /api/gocache/overview`

## Grafana (`http://grafana-prd.ituran.sp`)

- Protocolo HTTP interno (sem TLS)
- Auth: `Authorization: Bearer ${GRAFANA_TOKEN}`
- Acesso via datasource proxy do Grafana:
  - `prometheus` (UID `prometheus`) — métricas Kubernetes/JobScheduler
  - `integra-audit` (UID `P73FAD9A5042C01FF`) — logs Loki de auditoria
- Rotas backend: `GET /api/grafana/kubernetes`, `/api/grafana/jobscheduler`, `GET /api/audit/*`

## Azure OpenAI Foundry (`iturin-ai-eastus2-resource`)

- Endpoint: `https://iturin-ai-eastus2-resource.openai.azure.com/openai/v1`
- Deployment: `sentinela` (configurado no Azure Foundry pela equipe IA)
- SDK: `openai` oficial com `baseURL` apontando para o endpoint Azure
- Uso: narrativa executiva do Relatório de Ameaças (sob demanda)
- Fallback: resumo estático se indisponível
- Vars: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`

## SQL Server (`BRSPO1IDB11.ITURAN.SP\INTEGRA_ESPELHO`)

- Database: `ituranweb`
- Driver: `mssql`
- Uso: lookup `nm_pessoa` por `cd_pessoa` (campo `user_id` dos eventos do salesbo)
- Conectividade UDP/1434 + TCP dinâmico aprovada por Infra em 2026-04-26

## Conectividade necessária do cluster

Todos os endpoints abaixo devem ser alcançáveis a partir de pods em `integra-prd`:

| Endpoint | Porta | Protocolo |
|----------|-------|-----------|
| `seq-prd.ituran.sp` | 443 | HTTPS |
| `iturin-ai-eastus2-resource.openai.azure.com` | 443 | HTTPS |
| `api.us5.datadoghq.com` | 443 | HTTPS |
| `api.gocache.com.br` | 443 | HTTPS |
| `grafana-prd.ituran.sp` | 80 | HTTP |
| `BRSPO1IDB11.ITURAN.SP\INTEGRA_ESPELHO` | 1434/TCP dyn | UDP+TCP |
