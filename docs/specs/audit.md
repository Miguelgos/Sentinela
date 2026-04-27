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

Ranking dos usuários com mais eventos de auditoria. O campo `userId` corresponde ao `CD_PESSOA` do serviço de auditoria. O nome (`NM_PESSOA`) é consultado no banco espelho (`ituranweb`) via `app/server/fn/pessoa.ts` e exibido no lugar do código numérico — fallback para `#<id>` se não encontrado.

### Tabela de eventos recentes

Colunas: timestamp, serviço, usuário (NM_PESSOA ou #id), IP, página, flags.
Badges coloridos por serviço: integra (azul), customer360 (roxo), fieldservice (ciano).
Linhas destacadas em vermelho para IPs externos e em laranja para acessos a **dados desmascarados** (badge **DADO REAL**).

### Semântica do `ViewMaskedData`

> ⚠️ **Atenção:** o nome da flag é **invertido em relação ao significado.** No serviço de auditoria,
> `ViewMaskedData=true` significa que o usuário **visualizou os dados SEM máscara** (acessou o dado real).
> Ou seja: a flag rastreia *visualização do dado real*, não a aplicação de máscara.

Por isso o Sentinela usa o termo **`unmasked`** internamente e exibe **DADO REAL / desmascarado** na UI — para que a operação não interprete erroneamente o badge como "dado protegido por máscara".

Isso é relevante para LGPD: identifica usuários que clicaram explicitamente para revelar dados pessoais sensíveis (CPF, telefone, etc.) que normalmente vêm mascarados.

## Integração técnica

- Loki: `backend/src/lib/lokiClient.ts` (`lokiQueryRange`) — query range 24h, 2000 entradas por serviço
- Server function: `app/server/fn/audit.ts` (`getAuditOverview`)
- Nome do usuário: `app/server/fn/pessoa.ts` (`lookupPessoa`) → `backend/src/db/mssql.ts` (`lookupPessoas`)
- Query Loki: `/loki/api/v1/query_range` via `/api/datasources/proxy/uid/P73FAD9A5042C01FF/...`
- Auth: `Authorization: Bearer ${GRAFANA_TOKEN}`
- Tolerante a falha: retorna dados parciais se Loki indisponível (nunca lança exceção)

## Notas

- UID do datasource `P73FAD9A5042C01FF` está hardcoded em `lokiClient.ts:3`.
  Se o datasource for recriado no Grafana, atualizar a constante (Fase 8 pode mover para env var).
- Grafana usa HTTP (não HTTPS) — endpoint interno da Ituran.
