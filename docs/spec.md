# Especificação Funcional — Sentinela

## 1. Visão Geral

O **Sentinela** é um dashboard web interno de inteligência de logs para o serviço `salesbo` (Sales Backoffice) da Ituran, hospedado no Seq em `https://seq-prd.ituran.sp`. O objetivo é dar visibilidade sobre padrões de erro recorrentes, correlacionar eventos com usuários reais, detectar anomalias de segurança e facilitar investigações de incidentes.

## 2. Problemas Mapeados

### 2.1 GUID de Cotação vazio

```
Quote/PrintItens | UserId: {id} | GUID_COTACAO: 00000000-0000-0000-0000-000000000000 | Error: Cotação não encontrada
```

O endpoint `Quote/PrintItens` é chamado com `GUID_COTACAO` igual ao GUID nulo, indicando que o frontend aciona a impressão antes de obter ou definir um ID de cotação válido.

**Impacto:** Erros visíveis ao usuário, impossibilidade de imprimir itens da cotação.

### 2.2 Falhas de autenticação

```
Erro autenticação | Endpoint: /connect/token (ResourceOwner) | User: {email} | ClientId: {clientId} | StatusCode: Unauthorized
```

Usuários tentando autenticar via fluxo ResourceOwner no cliente `salesBackoffice` recebendo `Unauthorized`.

**Impacto:** Usuários impossibilitados de acessar o sistema.

### 2.3 Kong Auth Request com falhas

Eventos com `@MessageTemplate = 'Kong Auth Request'` e `StatusCode != 200` indicam autenticações rejeitadas pelo Kong Gateway. Inclui detecção de credential stuffing (IPs com ≥ 3 usuários distintos).

### 2.4 Findings de segurança

Padrões identificados nos logs com severidade classificada (Critical / High / Medium / Low):

| ID | Severidade | Descrição |
|----|-----------|-----------|
| SEC-010 | Critical | Token JWT de API Key (Serasa) exposto em texto plano nos logs |
| SEC-011 | Critical | Certificado SSL de dev expirado em uso em produção |
| SEC-001 | Critical | Credential stuffing — ≥ 3 tentativas em < 5min por usuário |
| SEC-002 | Critical | Exceções não tratadas (nível Critical) |
| SEC-012 | High | ASP.NET Data Protection — chaves sem criptografia |
| SEC-013 | High | ForwardedHeaders inconsistentes — risco IP spoofing |
| SEC-003 | High | Swagger/OpenAPI habilitado em produção |
| SEC-004 | High | Stack traces internos nos logs de produção |
| SEC-014 | High | LINQ avaliado no cliente (EF Core) |
| SEC-015 | Medium | Jobs Hangfire falhando |
| SEC-005 | Medium | Usernames em formato anômalo (ex.: CNPJ) |
| SEC-006 | Medium | Usuários com 100% de chamadas com GUID vazio |
| SEC-016 | Medium | IPs de veículos (PocSag) expostos nos logs |
| SEC-017 | Medium | Queries lentas (> 500ms) |

## 3. Requisitos Funcionais

### RF-01: Sincronização com Seq

- O sistema deve buscar eventos do Seq via API REST (`/api/events/`)
- Deve suportar filtro por signal (`signal-m33301` = apenas erros)
- Deve suportar filtro por intervalo de tempo (fromDateUtc / toDateUtc)
- Deve paginar automaticamente via parâmetro `afterId` até atingir o limite configurado
- Deve persistir eventos sem duplicação (upsert por `event_id`)

### RF-02: Auto-sync incremental

- O backend sincroniza automaticamente a cada 60 segundos
- **Incremental**: rastreia `newestEventId` — pára a paginação ao atingir o evento já visto
- **Primeira execução após restart**: limita ao Seq via `fromDateUtc` às últimas 6h (janela de retenção)
- **Retenção**: após cada ciclo, deleta eventos com `timestamp < NOW() - 6h` via `deleteOldEvents()`
- O usuário pode parar e reiniciar o auto-sync via UI
- A UI exibe status: runs, total importados, última execução, erros

### RF-03: Sync manual

- Presets de tempo: 1h, 4h, 12h, 24h, 48h, 7d
- Intervalo customizado com data/hora de início e fim
- Resultado exibido: importados, já existentes, total recebido, número de páginas

### RF-04: Importação manual de JSON

- Colar JSON exportado do Seq (formato CLEF ou `{ Events: [...] }`) e importar diretamente

### RF-05: Dashboard

- Totais: eventos, erros, GUID vazio, falhas de auth, usuários afetados (últimas 4h)
- Distribuição por nível (Error/Warning/Information/etc)
- Top erros por mensagem
- Top usuários por volume de eventos (com lookup de nome)
- Top serviços
- Breakdown de GUID de cotação (vazio / válido)
- Timeline de eventos por hora e nível (últimas 24h)
- **Exportar PDF**

### RF-06: Tabela de eventos

- Listagem paginada com filtros por: nível, serviço, usuário, GUID, path, texto livre, intervalo de datas
- Clique para ver detalhes completos do evento (raw_data)
- Exibição do nome do usuário via lookup no SQL Server

### RF-07: Análise — GUID Cotação vazio

- Total de eventos com GUID vazio (últimas 4h)
- Usuários afetados (únicos)
- Pico de erros (horário e contagem)
- Timeline por hora (erros + usuários únicos)
- Tabela de eventos com userId, nome do usuário, traceId, mensagem
- **Exportar PDF**

### RF-08: Análise — Falhas de Autenticação

- Total de falhas de autenticação (últimas 4h)
- Usuários com falha (e-mails únicos)
- Pico de erros
- Timeline por hora
- Top usuários (e-mail, contagem, última ocorrência)
- Top client IDs envolvidos
- Tabela de eventos recentes com e-mail, clientId, statusCode, traceId
- **Exportar PDF**

### RF-09: Análise — Kong Auth Request

- Eventos com `@MessageTemplate = 'Kong Auth Request'` e `StatusCode != 200` (últimas 4h)
- Métricas: total, falhas, sucessos, falhas 401, falhas 500, taxa de falha
- Timeline falhas vs. sucessos por hora
- Top usuários com falha (username, contagem, janela)
- Top IPs de origem (IP, falhas, usuários únicos)
- Detecção de **credential stuffing**: IPs com ≥ 3 usuários distintos em falhas
- Alerta de IPs internos (10.x, 192.168.x, 172.16-31.x)
- Tabela de erros 500
- Tabela de falhas recentes (últimas 50)
- **Exportar PDF**

### RF-10: Análise de Segurança

- Findings classificados por severidade (Critical / High / Medium)
- Cada finding exibe: descrição, dados quantitativos, ação recomendada
- Findings com dados (brute force, hangfire, stack traces) exibem tabelas detalhadas
- Tabela de falhas de auth por endpoint
- Tabela de top endpoints por volume de erro
- **Exportar PDF**

### RF-11: Exportação PDF

- Todas as páginas de análise têm botão "Exportar PDF"
- PDF inclui: cabeçalho azul com título/subtítulo/data de geração, rodapé com paginação, tabelas e seções
- Fonte Helvetica (CP1252) — sem emoji ou símbolos Unicode acima de U+00FF nos títulos
- Arquivo salvo com nome `{pagina}-{yyyy-MM-dd_HH-mm}.pdf`

### RF-12: Lookup de pessoa

- Dado um `user_id` (numérico = `cd_pessoa`), retornar `nm_pessoa` do banco `ituranweb` via SQL Server
- Suportar lookup em batch (múltiplos IDs de uma vez)
- Estatísticas por pessoa: total de eventos, erros, eventos com GUID vazio

## 4. Requisitos Não Funcionais

| Requisito | Valor |
|-----------|-------|
| Janela de queries de stats | Últimas 4 horas (`STATS_WINDOW`) |
| Retenção de dados local | 6 horas (deletado após cada ciclo de auto-sync) |
| Latência do dashboard | < 2s com índice trigram e janela de 4h |
| Volume esperado | Até ~500 eventos/hora por signal |
| SSL | Certificado autoassinado no Seq — verificação desabilitada |
| Autenticação no Seq | Desabilitada — endpoint público sem credenciais |
| PostgreSQL | `max_parallel_workers_per_gather = 0` para evitar esgotamento de memória compartilhada |

## 5. Modelo de Dados

### 5.1 seq_events

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | Chave interna |
| `event_id` | TEXT UNIQUE | ID do evento no Seq (evita duplicatas) |
| `timestamp` | TIMESTAMPTZ | Timestamp original do evento |
| `message_template` | TEXT | Template CLEF (`@mt`) |
| `message` | TEXT | Mensagem renderizada |
| `level` | TEXT | Error / Warning / Information / etc |
| `trace_id` | TEXT | ID de rastreio distribuído |
| `span_id` | TEXT | ID do span |
| `user_id` | TEXT | ID numérico do usuário (cd_pessoa), extraído por regex |
| `guid_cotacao` | TEXT | GUID da cotação, extraído por regex |
| `service` | TEXT | Nome do serviço (`dd_service`) |
| `environment` | TEXT | Ambiente (`dd_env`) |
| `request_path` | TEXT | Caminho HTTP da requisição |
| `source_context` | TEXT | Namespace/classe de origem do log |
| `raw_data` | JSONB | Evento completo em JSON (inclui Properties array) |
| `created_at` | TIMESTAMPTZ | Quando foi inserido localmente |

**Índices relevantes:**
- `UNIQUE (event_id)` — deduplicação
- `GIN (message gin_trgm_ops)` — aceleração de ILIKE (requer `pg_trgm`)
- `(timestamp)` — filtros de janela temporal

### 5.2 sync_config

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | |
| `seq_url` | TEXT | URL base do Seq |
| `api_key` | TEXT | API Key (quando usada) |
| `signal` | TEXT | Signal ID do Seq |
| `last_synced_at` | TIMESTAMPTZ | Última sincronização |
| `last_count` | INTEGER | Eventos importados na última sync |

## 6. Fluxo de Sincronização (Auto-sync Incremental)

```
Backend (auto-sync, 60s)
  │
  ├─ Se primeira execução (newestEventId === undefined):
  │      └─ adiciona fromDateUtc = NOW() - 6h à URL do Seq
  │
  ├─ GET /api/events/?count=1000&signal=signal-m33301&render=true[&afterId=...][&fromDateUtc=...]
  │      └─ Seq retorna array de SeqApiEvent
  │
  ├─ Para cada página:
  │      ├─ parseSeqApiEvent() → extrai campos normalizados
  │      ├─ Se encontrar newestEventId na página → pára paginação (incremental)
  │      └─ upsertEvents() → INSERT ... ON CONFLICT (event_id) DO NOTHING
  │
  ├─ Atualiza newestEventId com o evento mais recente visto
  │
  └─ deleteOldEvents(6) → DELETE WHERE timestamp < NOW() - 6h
```

## 7. Extração de Campos

### 7.1 Por regex na mensagem

| Campo | Padrão regex | Exemplo |
|-------|-------------|---------|
| `user_id` | `UserId:\s*(\d+)` | `UserId: 1348383` |
| `guid_cotacao` | `GUID_COTACAO:\s*([0-9a-fA-F-]{36})` | `GUID_COTACAO: 00000000-...` |
| Email (auth errors) | `User:\s*(\S+)\s*\|` | `User: contato@taseguroai.com.br \|` |
| ClientId (auth errors) | `ClientId:\s*(\S+)\s*\|` | `ClientId: salesBackoffice \|` |
| StatusCode (auth errors) | `StatusCode:\s*(\S+)\s*\|` | `StatusCode: Unauthorized \|` |

### 7.2 Por JSONB (Kong Auth)

Propriedades armazenadas em `raw_data->'Properties'` como array `[{"Name": "X", "Value": Y}]`:

```sql
(SELECT (elem->>'Value')::int
 FROM jsonb_array_elements(raw_data->'Properties') elem
 WHERE elem->>'Name' = 'StatusCode')
```

Propriedades extraídas: `StatusCode` (int), `Username` (text), `ClientIp` (text), `Path` (text), `Module` (text).

## 8. Telas

| Página | Rota interna | Componente | PDF |
|--------|-------------|------------|-----|
| Dashboard | `dashboard` | `Dashboard.tsx` | `exportDashboardPdf` |
| Eventos | `logs` | `LogsTable.tsx` | — |
| GUID Cotação vazio | `analysis` | `ErrorAnalysis.tsx` | `exportErrorAnalysisPdf` |
| Falhas de Autenticação | `auth-errors` | `AuthErrorAnalysis.tsx` | `exportAuthErrorPdf` |
| Kong Auth | `kong-auth` | `KongAuthAnalysis.tsx` | `exportKongAuthPdf` |
| Segurança | `security` | `SecurityAnalysis.tsx` | `exportSecurityPdf` |
| Configurar Sync | `sync` | `SyncConfig.tsx` | — |
