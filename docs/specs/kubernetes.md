# Spec — Kubernetes (Grafana/Prometheus)

**Rota interna:** `kubernetes`
**Componente:** `KubernetesAnalysis.tsx`
**Endpoint backend:** `GET /api/grafana/kubernetes`
**PDF:** não tem

## Contexto

A página Kubernetes consulta métricas do namespace `integra-prd` via Prometheus,
acessado pelo datasource proxy do Grafana interno (`http://grafana-prd.ituran.sp`).
Datasource UID: `prometheus`.

## Funcionalidades

### Pods do salesbo

Para cada pod com label `pod=~"salesbo.*"` no namespace `integra-prd`:

- CPU (% de uso, via `rate(container_cpu_usage_seconds_total[5m])*100`)
- Memória em MB (`container_memory_working_set_bytes`)
- Restarts totais (`kube_pod_container_status_restarts_total`)

Barra de CPU colorida: verde (< 50%), amarelo (50-80%), vermelho (> 80%).

### Deployment salesbo

- Réplicas desejadas (`kube_deployment_spec_replicas`)
- Réplicas disponíveis (`kube_deployment_status_replicas_available`)

### Deployments com 0 réplicas disponíveis

Alerta para qualquer deployment em `integra-prd` com `available == 0`.

### Todos os pods com restarts

Tabela de pods em `integra-prd` com restarts > 0.

### Alertas ativos (Prometheus)

Lista de alertas com `ALERTS{alertstate="firing"}` via `grafanaFiringAlerts()`.
Cada alerta exibe: nome, severidade (Critical / Warning / Info), labels.

## Integração técnica

- Cliente: `backend/src/lib/grafanaClient.ts` (`grafanaPromQuery`, `grafanaFiringAlerts`)
- Rota: `backend/src/routes/grafana.ts` handler `/kubernetes`
- Todas as queries são `Promise.allSettled` — falha parcial retorna dados disponíveis
- Auth: `Authorization: Bearer ${GRAFANA_TOKEN}`
