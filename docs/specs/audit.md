# Spec — Auditoria (Loki)

**Rota interna:** `audit`
**Componente:** `AuditAnalysis.tsx`
**Endpoints backend:** `GET /api/audit/*`
**PDF:** não tem

## Contexto

A página Auditoria consulta o Loki via datasource proxy do Grafana interno
(`http://grafana-prd.ituran.sp`). O datasource `integra-audit` (UID `P73FAD9A5042C01FF`)
agrega logs de auditoria dos serviços integra, customer360 e fieldservice (~140k eventos/24h).

## Funcionalidades

### Totais e resumo

- Volume de eventos de auditoria nas últimas 24h
- Distribuição por serviço (integra / customer360 / fieldservice)
- Distribuição por tipo de ação

### Timeline

Gráfico de volume de logs por hora, colorido por serviço.

### Top usuários e ações

Ranking dos usuários com mais eventos de auditoria e das ações mais frequentes.

### Tabela de eventos recentes

Colunas: timestamp, serviço, usuário, ação, detalhes.
Badges coloridos por serviço: integra (azul), customer360 (roxo), fieldservice (ciano).

## Integração técnica

- Cliente: `backend/src/lib/lokiClient.ts` (`lokiQueryRange`)
- Rota: `backend/src/routes/audit.ts`
- Query Loki: `/loki/api/v1/query_range` via `/api/datasources/proxy/uid/P73FAD9A5042C01FF/...`
- Auth: `Authorization: Bearer ${GRAFANA_TOKEN}`
- Tolerante a falha: retorna dados parciais se Loki indisponível (nunca lança exceção)

## Notas

- UID do datasource `P73FAD9A5042C01FF` está hardcoded em `lokiClient.ts:3`.
  Se o datasource for recriado no Grafana, atualizar a constante (Fase 8 pode mover para env var).
- Grafana usa HTTP (não HTTPS) — endpoint interno da Ituran.
