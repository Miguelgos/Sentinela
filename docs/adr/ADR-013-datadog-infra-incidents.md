# ADR-013 — Datadog: Expansão para Incidentes, SLOs, Downtimes e Métricas de Infraestrutura

## Status

Aceito

## Contexto

A integração original com o Datadog cobria apenas monitores, logs por serviço e hosts. Sinais operacionais críticos estavam ausentes: incidentes ativos em produção, conformidade de SLOs, downtimes agendados e pressão de recursos de infraestrutura (CPU, memória, disco, reinicializações de pods Kubernetes).

## Decisão

- A rota `/api/datadog/overview` foi estendida para buscar no mesmo `Promise.all`: SLOs (`/api/v1/slo?limit=50`), downtimes ativos (`/api/v1/downtime?current_only=true`) e incidentes ativos (`/api/v2/incidents?page[size]=20`). Apenas incidentes não resolvidos (onde `attributes.resolved == null`) são incluídos.
- Criado o novo endpoint `/api/datadog/infra` que busca 6 métricas de série temporal em paralelo via `/api/v1/query`:
  - `avg:system.cpu.user{*}by{host}` — utilização de CPU
  - `avg:system.mem.used{*}by{host}` — memória utilizada (convertida para GB no frontend)
  - `avg:system.disk.in_use{*}by{host}` — percentual de uso de disco
  - `sum:system.net.bytes_rcvd{*}by{host}` — throughput de rede
  - `sum:kubernetes.containers.restarts{*}by{kube_deployment}` — reinicializações de pods K8s
  - `avg:container.cpu.usage{*}by{container_name}` — CPU de containers
- Métricas adicionais de SQL Server foram incluídas em `/api/datadog/metrics`: `page_life_expectancy`, `user_connections`, `batch_requests_sec`.
- O helper compartilhado `extract(raw)` foi promovido ao escopo de módulo (anteriormente duplicado em cada handler de rota).
- A regra de ameaça `ACTIVE_INCIDENT` em `report.ts` utiliza o endpoint de incidentes, e `INFRA_STRESS` utiliza as métricas de CPU, disco e reinicializações de pods buscadas de forma independente na rota de relatório.
- O componente frontend `DatadogAnalysis.tsx` exibe: banner de incidente ativo, linha informativa de downtime, tabela de SLOs, 4 cards de resumo de infraestrutura, gráfico de barras de CPU, gráfico de barras de disco, tabela de reinicializações de pods e tabela de CPU de containers.

## Consequências

- (+) Incidentes ativos agora são exibidos imediatamente com um banner vermelho — sinal operacional de maior prioridade.
- (+) A visibilidade da pressão de infraestrutura ajuda a correlacionar erros de aplicação com esgotamento de recursos.
- (+) As regras `INFRA_STRESS` e `ACTIVE_INCIDENT` enriquecem significativamente o relatório de ameaças.
- (-) `/api/datadog/overview` agora realiza 6 chamadas paralelas à API (em vez de 3) — latência limitada pela chamada mais lenta (timeout de aproximadamente 15 segundos).
- (-) As métricas de infraestrutura requerem que o agente Datadog reporte `system.*` e `kubernetes.*` — podem retornar vazias em hosts sem o agente completo instalado.
