# Spec — Relatório de Ameaças

**Rota interna:** `report`
**Componente:** `ReportAnalysis.tsx`
**Endpoint:** `GET /api/report/threat`
**PDF:** `exportThreatReportPdf`

## Requisito funcional (RF-15)

Geração sob demanda de um relatório executivo consolidado com correlação cruzada
dos dados de Seq, Datadog, GoCache e Grafana.

## 15 regras de correlação

| # | Regra | Fonte | Descrição |
|---|-------|-------|-----------|
| 1 | `BRUTE_FORCE` | Seq | Tentativas de brute force nos logs de auth |
| 2 | `ANOMALOUS_USERNAMES` | Seq | Usernames em formato anômalo (ex.: CNPJ como login) |
| 3 | `WAF_INJECTION` | GoCache | Ataques SQLi/XSS bloqueados pelo WAF |
| 4 | `MULTI_SOURCE_IP` | Seq | Mesmo usuário acessando de múltiplos IPs simultâneos |
| 5 | `EXPIRED_CERTS` | Seq | Certificados SSL/TLS expirados em uso em produção |
| 6 | `DATADOG_ALERT` | Datadog | Monitores em estado Alert ou Warn |
| 7 | `HIGH_ERROR_RATE` | Seq | Taxa de erros acima do limiar esperado |
| 8 | `ACTIVE_INCIDENT` | Datadog | Incidentes ativos registrados no Datadog |
| 9 | `SCANNER_DETECTED` | GoCache | Scanners de vulnerabilidade (Nikto, SQLMap, etc.) |
| 10 | `BOT_ATTACK` | GoCache | Bots maliciosos bloqueados |
| 11 | `INFRA_STRESS` | Datadog | CPU/memória/disco de hosts em nível crítico |
| 12 | `GEO_CONCENTRATION` | GoCache | Concentração anômala de ataques em um único país |
| 13 | `PROMETHEUS_ALERT` | Grafana | Alertas Prometheus em `alertstate="firing"` |
| 14 | `DEPLOYMENT_DOWN` | Grafana | Deployments em `integra-prd` com 0 réplicas disponíveis |
| 15 | `JOBSCHEDULER_ERRORS` | Grafana | Jobs Hangfire com alta taxa de falha |

Cada regra produz: `status` (triggered/clear), `severity`, `description`, `evidences[]`.

## Narrativa executiva (Azure OpenAI)

Gerada pelo deployment `sentinela` no Azure OpenAI Foundry (`iturin-ai-eastus2-resource`):
- ~400 palavras em 4 seções estruturadas
- Seções: Resumo Executivo, Ameaças Prioritárias, Recomendações Imediatas, Avaliação de Risco
- SDK `openai` com `baseURL` apontando para endpoint Azure
- Fallback automático para resumo estático se API indisponível

## Exportação PDF

`exportThreatReportPdf` — inclui logo Sentinela, seções de findings e tabelas de evidências.
Arquivo: `relatorio-ameacas-{yyyy-MM-dd_HH-mm}.pdf`.
