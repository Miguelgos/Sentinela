# Especificação Funcional — Sentinela

## 1. Visão Geral

O **Sentinela** é um dashboard web interno de inteligência de logs e segurança para o serviço `salesbo` (Sales Backoffice) da Ituran, hospedado no Seq em `https://seq-prd.ituran.sp`. O objetivo é dar visibilidade sobre padrões de erro recorrentes, correlacionar eventos com usuários reais, detectar anomalias de segurança, monitorar infraestrutura via Datadog, acompanhar proteção de perímetro via GoCache WAF e gerar relatórios executivos de ameaças com correlação cruzada e narrativa gerada por IA (Claude Haiku 4.5 — Anthropic).

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

Monitoramento da infraestrutura Windows (IIS + SQL Server), estado de monitores Datadog e observabilidade de serviços:

- Estado dos monitores (Alert / Warn / OK / No Data)
- Volume de logs por serviço (últimas 4h)
- Hosts ativos e suas aplicações
- Métricas IIS: conexões ativas, requisições GET/POST por site, bytes transferidos, erros 404
- Métricas SQL Server: conexões bloqueadas, full table scans/s, page life expectancy, user connections, batch requests/s
- **SLOs**: lista e limiares via `GET /api/v1/slo`
- **Downtimes ativos**: janelas de manutenção via `GET /api/v1/downtime`
- **Incidentes ativos**: incidentes em curso via `GET /api/v2/incidents`
- **Infra metrics** (endpoint `/api/datadog/infra`): CPU por host (`avg:system.cpu.user`), memória usada em GB (`avg:system.mem.used`), disco em % (`avg:system.disk.in_use`), rede em Mbps (`sum:system.net.bytes_rcvd`), restarts de pods K8s (`sum:kubernetes.containers.restarts by{kube_deployment}`), CPU de containers (`avg:container.cpu.usage by{container_name}`)

### 2.6 GoCache WAF — Proteção de Perímetro

Monitoramento dos eventos de segurança de borda nas últimas 24h:

- Eventos WAF bloqueados (SQL Injection, XSS, injeção)
- IPs bloqueados por firewall (blacklist)
- Bots detectados e bloqueados
- Bots em modo monitor (simulação)
- Top IPs atacantes, tipos de ataque, URIs e hosts mais visados
- **Paginação multi-página**: até 500 eventos WAF e 300 eventos bot via parâmetro `page` no corpo da requisição
- **Classificação de ataques**: SQLi, XSS, PathTraversal, Scanner, Protocol, Other
- **Detecção de ferramentas ofensivas**: SQLMap, Nikto, Dart, Python, curl, Go, Java, Headless (via User-Agent)
- **Timeline horária**: volume de eventos WAF, Bot e Firewall por hora
- **Concentração geográfica**: ranking de países de origem dos ataques
- **Tipos de bot e user-agents ofensivos**: breakdown de `botTypes` e `userAgentTools`
- **Totais consolidados** (`totals`) e distribuição por método HTTP (`byMethod`)

### 2.7 Relatório de Ameaças Cibernéticas

Geração sob demanda de um relatório executivo consolidado:

- **12 regras de correlação cruzada** sobre dados de Seq, Datadog e GoCache: `BRUTE_FORCE`, `ANOMALOUS_USERNAMES`, `WAF_INJECTION`, `MULTI_SOURCE_IP`, `EXPIRED_CERTS`, `DATADOG_ALERT`, `HIGH_ERROR_RATE`, `ACTIVE_INCIDENT`, `SCANNER_DETECTED`, `BOT_ATTACK`, `INFRA_STRESS`, `GEO_CONCENTRATION`
- **Narrativa executiva** gerada pelo Claude Haiku 4.5 (Anthropic): ~400 palavras em 4 seções estruturadas (Resumo Executivo, Ameaças Prioritárias, Recomendações Imediatas, Avaliação de Risco); fallback estático se API indisponível
- **Exportação PDF** com logo Sentinela, seções de findings e tabelas de evidências (`exportThreatReportPdf`)

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
- Logo: arquivo SVG `sentinela_v1_radar_pulso.svg` rasterizado via Canvas API no carregamento do módulo e embutido como PNG em todos os cabeçalhos
- Arquivo salvo com nome `{pagina}-{yyyy-MM-dd_HH-mm}.pdf`
- Páginas com PDF: Dashboard (`exportDashboardPdf`), GUID Cotação vazio (`exportErrorAnalysisPdf`), Falhas de Autenticação (`exportAuthErrorPdf`), Kong Auth (`exportKongAuthPdf`), Segurança (`exportSecurityPdf`), Relatório de Ameaças (`exportThreatReportPdf`)

### RF-12: Lookup de pessoa

- Dado um `user_id` (numérico = `cd_pessoa`), retornar `nm_pessoa` do banco `ituranweb` via SQL Server
- Suportar lookup em batch (múltiplos IDs de uma vez)
- Estatísticas por pessoa: total de eventos, erros, eventos com GUID vazio

### RF-13: Datadog — Infraestrutura & Monitores

- Conectar à API Datadog (`api.us5.datadoghq.com`) via `DD-API-KEY` + `DD-APPLICATION-KEY`
- **Monitores**: contagem por estado (Alert/Warn/OK/No Data), lista dos em alerta/warn, alertas de licença
- **Logs**: volume por serviço (error/warn/info) nas últimas 4h via `/api/v2/logs/events`
- **Hosts**: lista de hosts ativos com aplicações via `/api/v1/hosts`
- **SLOs**: lista e limiares via `/api/v1/slo`
- **Downtimes ativos**: janelas de manutenção em curso via `/api/v1/downtime`
- **Incidentes ativos**: incidentes em curso via `/api/v2/incidents`
- **Métricas IIS** (última hora via `/api/v1/query`):
  - Conexões ativas por host
  - Requisições GET + POST por site
  - Bytes transferidos por host
  - Erros 404 por host
- **Métricas SQL Server** (última hora):
  - Conexões bloqueadas por host
  - Full table scans/s por host
  - Page life expectancy por host
  - User connections por host
  - Batch requests/s por host
- **Métricas de infra** (`/api/datadog/infra`):
  - CPU por host (`avg:system.cpu.user{*}by{host}`)
  - Memória usada em GB por host (`avg:system.mem.used{*}by{host}`)
  - Disco em uso % por host (`avg:system.disk.in_use{*}by{host}`)
  - Rede recebida Mbps por host (`sum:system.net.bytes_rcvd{*}by{host}`)
  - Restarts de pods K8s por deployment (`sum:kubernetes.containers.restarts{*}by{kube_deployment}`)
  - CPU de containers (`avg:container.cpu.usage{*}by{container_name}`)

### RF-14: GoCache WAF — Proteção de Perímetro

- Conectar à API GoCache via header `GoCache-Token: <token>`
- **Resumo 24h**: totais consolidados (`totals`) — WAF bloqueados, firewall bloqueados, bots bloqueados, bots em modo monitor
- **Paginação**: até 500 eventos WAF e 300 eventos bot via parâmetro `page` no corpo da requisição
- **Análise**: top IPs atacantes, top tipos de ataque WAF, top URIs atacadas, top hosts visados
- **Classificação de ataques**: categorias SQLi, XSS, PathTraversal, Scanner, Protocol, Other
- **Detecção de ferramentas**: SQLMap, Nikto, Dart, Python, curl, Go, Java, Headless via User-Agent
- **Timeline horária**: volume de eventos WAF, Bot e Firewall por hora (`timeline`)
- **Concentração geográfica**: ranking de países de origem dos ataques (`byCountry`)
- **Tipos de bot**: breakdown de `botTypes` e `userAgentTools`
- **Distribuição por método HTTP**: `byMethod`
- Banner de contexto com domínios protegidos e totais do dia

### RF-15: Relatório de Ameaças Cibernéticas

- Geração sob demanda via `GET /api/report/threat`
- **12 regras de correlação cruzada** sobre dados de Seq, Datadog e GoCache: `BRUTE_FORCE`, `ANOMALOUS_USERNAMES`, `WAF_INJECTION`, `MULTI_SOURCE_IP`, `EXPIRED_CERTS`, `DATADOG_ALERT`, `HIGH_ERROR_RATE`, `ACTIVE_INCIDENT`, `SCANNER_DETECTED`, `BOT_ATTACK`, `INFRA_STRESS`, `GEO_CONCENTRATION`
- Cada regra produz: status (triggered/clear), severidade, descrição e evidências tabuladas
- **Narrativa executiva** gerada pelo Claude Haiku 4.5 (~400 palavras, 4 seções estruturadas): Resumo Executivo, Ameaças Prioritárias, Recomendações Imediatas, Avaliação de Risco
- Fallback automático para resumo estático se a API Anthropic estiver indisponível ou bloqueada
- **Exportação PDF** com logo, seções de findings e tabelas de evidências (`exportThreatReportPdf`)

## 4. Requisitos Não Funcionais

| Requisito | Valor |
|-----------|-------|
| Janela de queries de stats | Últimas 4 horas (`STATS_WINDOW`) |
| Retenção de dados local | Tier A (eventos críticos): 90 dias; Tier B (informativos): 7 dias |
| Store in-memory | Map em `accumulator.ts` para consultas de stats sem I/O de disco |
| Latência do dashboard | < 2s com consultas à store in-memory |
| Volume esperado | Até ~500 eventos/hora por signal |
| SSL | Certificado autoassinado no Seq — verificação desabilitada |
| TLS externo (Datadog/GoCache/Anthropic) | `rejectUnauthorized: false` no WSL (WSL não resolve a cadeia de CA) |
| Autenticação no Seq | Desabilitada — endpoint público sem credenciais |
| Banco de dados local | SQLite (`better-sqlite3`), arquivo `data/events.db` — sem Docker necessário |
| GoCache paginação | Até 500 eventos WAF e 300 bot via parâmetro `page` |

## 5. Modelo de Dados

O armazenamento principal é um arquivo SQLite (`data/events.db`) gerenciado por `db/sqlite.ts` com retenção em dois tiers. Paralelamente, `accumulator.ts` mantém uma store in-memory (Map) com os eventos recentes para servir as queries de stats sem I/O de disco.

**Tiered retention:**
- **Tier A** (eventos críticos — Error, security findings, auth failures): retenção de 90 dias
- **Tier B** (eventos informativos): retenção de 7 dias

### 5.1 seq_events (SQLite)

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | INTEGER PK | Chave interna (autoincrement) |
| `event_id` | TEXT UNIQUE | ID do evento no Seq (evita duplicatas) |
| `timestamp` | TEXT | Timestamp original do evento (ISO 8601) |
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
| `raw_data` | TEXT | Evento completo em JSON (serializado) |
| `created_at` | TEXT | Quando foi inserido localmente (ISO 8601) |

**Índices relevantes:**
- `UNIQUE (event_id)` — deduplicação
- `(timestamp)` — filtros de janela temporal e retenção por tier

## 6. Fluxo de Polling (Accumulator)

```
accumulator.ts (polling contínuo)
  │
  ├─ seq.ts: GET /api/events/?count=1000&signal=signal-m33301&render=true[&afterId=...]
  │      └─ Seq retorna array de SeqApiEvent
  │
  ├─ Para cada página:
  │      ├─ parseSeqApiEvent() → extrai campos normalizados
  │      ├─ Se encontrar newestEventId na página → pára paginação (incremental)
  │      ├─ Adiciona evento à store in-memory (Map<event_id, SeqEvent>)
  │      └─ db/sqlite.ts: upsert → INSERT OR IGNORE (event_id)
  │
  ├─ Atualiza newestEventId com o evento mais recente visto
  │
  └─ Retenção por tier:
       ├─ Tier A (críticos): remove da store/SQLite após 90 dias
       └─ Tier B (informativos): remove da store/SQLite após 7 dias
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

### 7.2 Por JSON (Kong Auth)

Propriedades armazenadas em `raw_data` (TEXT serializado como JSON) como array `Properties: [{"Name": "X", "Value": Y}]`. O backend faz parse em memória via `JSON.parse()` e extrai os campos pelo nome:

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
| Relatório de Ameaças | `report` | `ReportAnalysis.tsx` | `exportThreatReportPdf` |
| Configurar Sync | `sync` | `SyncConfig.tsx` | — |

## 9. Integrações Externas

### 9.1 Datadog (`api.us5.datadoghq.com`)

Autenticação via `DD-API-KEY` + `DD-APPLICATION-KEY`. Endpoints consumidos:

| Endpoint Datadog | Uso |
|-----------------|-----|
| `GET /api/v1/monitor` | Estado de todos os monitores |
| `GET /api/v2/logs/events` | Logs das últimas 4h (volume por serviço) |
| `GET /api/v1/hosts` | Lista de hosts ativos |
| `GET /api/v1/slo` | SLOs e limiares configurados |
| `GET /api/v1/downtime` | Downtimes ativos (janelas de manutenção) |
| `GET /api/v2/incidents` | Incidentes ativos em curso |
| `GET /api/v1/query` | Métricas de série temporal (IIS, SQL Server, infra) |

Métricas consultadas via `/api/v1/query` — endpoint `/api/datadog/metrics` (IIS e SQL Server):

| Métrica | Agrupamento | Significado |
|---------|------------|-------------|
| `sum:iis.net.num_connections{*}` | `by{host}` | Conexões HTTP ativas |
| `sum:iis.httpd_request_method.get{*}` | `by{site}` | Requisições GET/s por site IIS |
| `sum:iis.httpd_request_method.post{*}` | `by{site}` | Requisições POST/s por site IIS |
| `sum:iis.net.bytes_total{*}` | `by{host}` | Throughput (bytes/s) por host |
| `sum:iis.errors.not_found{*}` | `by{host}` | Taxa de erros 404/s |
| `avg:sqlserver.activity.blocked_connections{*}` | `by{host}` | Conexões SQL bloqueadas |
| `avg:sqlserver.access.full_scans{*}` | `by{host}` | Full table scans/s |
| `avg:sqlserver.performance.page_life_expectancy{*}` | `by{host}` | Page life expectancy (Buffer Pool) |
| `avg:sqlserver.activity.user_connections{*}` | `by{host}` | Conexões de usuário ativas |
| `avg:sqlserver.performance.batch_requests_sec{*}` | `by{host}` | Batch requests/s |

Métricas consultadas via `/api/v1/query` — endpoint `/api/datadog/infra` (infraestrutura de host):

| Métrica | Agrupamento | Significado |
|---------|------------|-------------|
| `avg:system.cpu.user{*}` | `by{host}` | CPU de usuário (%) por host |
| `avg:system.mem.used{*}` | `by{host}` | Memória usada (GB) por host |
| `avg:system.disk.in_use{*}` | `by{host}` | Disco em uso (%) por host |
| `sum:system.net.bytes_rcvd{*}` | `by{host}` | Rede recebida (Mbps) por host |
| `sum:kubernetes.containers.restarts{*}` | `by{kube_deployment}` | Restarts de pods K8s por deployment |
| `avg:container.cpu.usage{*}` | `by{container_name}` | CPU de containers (%) |

### 9.2 GoCache WAF (`api.gocache.com.br`)

Autenticação via header `GoCache-Token: <token>`. Consultas paralelas às últimas 24h com paginação:

| Tipo | Action | Significado |
|------|--------|-------------|
| `waf` | `block` | Ataques bloqueados pelo WAF (SQLi, XSS, etc.) |
| `firewall` | `block` | IPs bloqueados por blacklist |
| `bot-mitigation` | `block` | Bots detectados e bloqueados |
| `bot-mitigation` | `simulate` | Bots detectados em modo monitor |

**Paginação**: o parâmetro `page` é passado no corpo da requisição POST. O backend itera páginas até esgotar os resultados, com limite máximo de 500 eventos WAF e 300 eventos bot.

**Classificação de ataques** (função `classifyAttack`): cada evento WAF é classificado em uma categoria:

| Categoria | Critério |
|-----------|---------|
| `SQLi` | Padrões de SQL Injection no payload ou tipo de ataque |
| `XSS` | Padrões de Cross-Site Scripting |
| `PathTraversal` | Tentativas de traversal de diretório (`../`) |
| `Scanner` | User-Agents ou padrões de scanner de vulnerabilidades |
| `Protocol` | Violações de protocolo HTTP |
| `Other` | Demais ataques não classificados |

**Detecção de ferramentas** (função `detectTool`): identifica ferramentas ofensivas pelo User-Agent:
SQLMap, Nikto, Dart, Python, curl, Go, Java, Headless (browsers headless).

### 9.3 Anthropic API (`api.anthropic.com`)

Autenticação via header `x-api-key: ANTHROPIC_API_KEY` + header `anthropic-version: 2023-06-01`.

| Campo | Valor |
|-------|-------|
| Endpoint | `POST /v1/messages` |
| Model | `claude-haiku-4-5-20251001` |
| Uso | Narrativa executiva do Relatório de Ameaças |
| Prompt | ~400 palavras, 4 seções estruturadas: Resumo Executivo, Ameaças Prioritárias, Recomendações Imediatas, Avaliação de Risco |
| Fallback | Resumo estático gerado localmente se API indisponível, timeout ou bloqueio de proxy |

O cliente HTTP está em `lib/geminiClient.ts` (nome mantido por compatibilidade interna). A chamada é feita sob demanda apenas quando `GET /api/report/threat` é invocado.

> Nota: `generativelanguage.googleapis.com` (Gemini) está bloqueado pelo Forcepoint na rede corporativa. `api.anthropic.com` está acessível.
