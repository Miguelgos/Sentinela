# Especificação Funcional — Sentinela

## 1. Visão Geral

O **Sentinela** é um dashboard web interno de inteligência de logs e segurança para o serviço `salesbo` (Sales Backoffice) da Ituran, hospedado no Seq em `https://seq-prd.ituran.sp`. O objetivo é dar visibilidade sobre padrões de erro recorrentes, correlacionar eventos com usuários reais, detectar anomalias de segurança, monitorar infraestrutura via Datadog e acompanhar proteção de perímetro via GoCache WAF.

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

### 2.5 Datadog — Infraestrutura

Monitoramento da infraestrutura Windows (IIS + SQL Server) e do estado de monitores Datadog:

- Estado dos monitores (Alert / Warn / OK / No Data)
- Volume de logs por serviço (últimas 4h)
- Hosts ativos e suas aplicações
- Métricas IIS: conexões ativas, requisições GET/POST por site, bytes transferidos, erros 404
- Métricas SQL Server: conexões bloqueadas, full table scans/s

### 2.6 GoCache WAF — Proteção de Perímetro

Monitoramento dos eventos de segurança de borda nas últimas 24h:

- Eventos WAF bloqueados (SQL Injection, XSS, injeção)
- IPs bloqueados por firewall (blacklist)
- Bots detectados e bloqueados
- Bots em modo monitor (simulação)
- Top IPs atacantes, tipos de ataque, URIs e hosts mais visados

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
- PDF inclui: cabeçalho azul com logo Sentinela + título/subtítulo/data de geração, rodapé com paginação, tabelas e seções
- Fonte Helvetica (CP1252) — sem emoji ou símbolos Unicode acima de U+00FF nos títulos
- Logo desenhado com primitivas jsPDF (shield + eye) — sem dependência de arquivo externo
- Arquivo salvo com nome `{pagina}-{yyyy-MM-dd_HH-mm}.pdf`

### RF-12: Lookup de pessoa

- Dado um `user_id` (numérico = `cd_pessoa`), retornar `nm_pessoa` do banco `ituranweb` via SQL Server
- Suportar lookup em batch (múltiplos IDs de uma vez)
- Estatísticas por pessoa: total de eventos, erros, eventos com GUID vazio

### RF-13: Datadog — Infraestrutura & Monitores

- Conectar à API Datadog (`api.us5.datadoghq.com`) via `DD-API-KEY` + `DD-APPLICATION-KEY`
- **Monitores**: contagem por estado (Alert/Warn/OK/No Data), lista dos em alerta/warn, alertas de licença
- **Logs**: volume por serviço (error/warn/info) nas últimas 4h via `/api/v2/logs/events`
- **Hosts**: lista de hosts ativos com aplicações via `/api/v1/hosts`
- **Métricas IIS** (última hora via `/api/v1/query`):
  - Conexões ativas por host
  - Requisições GET + POST por site
  - Bytes transferidos por host
  - Erros 404 por host
- **Métricas SQL Server** (última hora):
  - Conexões bloqueadas por host
  - Full table scans/s por host

### RF-14: GoCache WAF — Proteção de Perímetro

- Conectar à API GoCache via header `GoCache-Token: <token>`
- **Resumo 24h**: total WAF bloqueados, firewall bloqueados, bots bloqueados, bots em modo monitor
- **Análise**: top IPs atacantes, top tipos de ataque WAF, top URIs atacadas, top hosts visados
- **Eventos recentes**: tabelas dos últimos eventos WAF, firewall e bot (máx. 100 cada por limitação da API)
- Banner de contexto com domínios protegidos e totais do dia

## 4. Requisitos Não Funcionais

| Requisito | Valor |
|-----------|-------|
| Janela de queries de stats | Últimas 4 horas (`STATS_WINDOW`) |
| Retenção de dados local | 6 horas (deletado após cada ciclo de auto-sync) |
| Latência do dashboard | < 2s com índice trigram e janela de 4h |
| Volume esperado | Até ~500 eventos/hora por signal |
| SSL | Certificado autoassinado no Seq — verificação desabilitada |
| TLS externo (Datadog/GoCache) | `rejectUnauthorized: false` no WSL (WSL não resolve a cadeia de CA) |
| Autenticação no Seq | Desabilitada — endpoint público sem credenciais |
| PostgreSQL | `max_parallel_workers_per_gather = 0` para evitar esgotamento de memória compartilhada |
| GoCache API limit | Máximo 100 eventos por requisição |

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
| Datadog | `datadog` | `DatadogAnalysis.tsx` | — |
| GoCache WAF | `gocache` | `GoCacheAnalysis.tsx` | — |
| Configurar Sync | `sync` | `SyncConfig.tsx` | — |

## 9. Integrações Externas

### 9.1 Datadog (`api.us5.datadoghq.com`)

Autenticação via `DD-API-KEY` + `DD-APPLICATION-KEY`. Endpoints consumidos:

| Endpoint Datadog | Uso |
|-----------------|-----|
| `GET /api/v1/monitor` | Estado de todos os monitores |
| `GET /api/v2/logs/events` | Logs das últimas 4h (volume por serviço) |
| `GET /api/v1/hosts` | Lista de hosts ativos |
| `GET /api/v1/query` | Métricas IIS e SQL Server (série temporal, última hora) |

Métricas consultadas via `/api/v1/query`:

| Métrica | Agrupamento | Significado |
|---------|------------|-------------|
| `sum:iis.net.num_connections{*}` | `by{host}` | Conexões HTTP ativas |
| `sum:iis.httpd_request_method.get{*}` | `by{site}` | Requisições GET/s por site IIS |
| `sum:iis.httpd_request_method.post{*}` | `by{site}` | Requisições POST/s por site IIS |
| `sum:iis.net.bytes_total{*}` | `by{host}` | Throughput (bytes/s) por host |
| `sum:iis.errors.not_found{*}` | `by{host}` | Taxa de erros 404/s |
| `avg:sqlserver.activity.blocked_connections{*}` | `by{host}` | Conexões SQL bloqueadas |
| `avg:sqlserver.access.full_scans{*}` | `by{host}` | Full table scans/s |

> Nota: métricas `system.cpu.*` e `system.mem.*` não estão disponíveis neste ambiente — o agente Datadog monitora IIS/SQL Server Windows, não métricas de host genéricas.

### 9.2 GoCache WAF

Autenticação via header `GoCache-Token: <token>`. Consultas paralelas às últimas 24h:

| Tipo | Action | Significado |
|------|--------|-------------|
| `waf` | `block` | Ataques bloqueados pelo WAF (SQLi, XSS, etc.) |
| `firewall` | `block` | IPs bloqueados por blacklist |
| `bot-mitigation` | `block` | Bots detectados e bloqueados |
| `bot-mitigation` | `simulate` | Bots detectados em modo monitor |

Limite da API GoCache: 100 eventos por requisição. O campo `size` da resposta indica o total real de eventos no período.
