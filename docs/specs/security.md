# Spec — Segurança, Kong Auth e Auth Errors

## Página Segurança (RF-10)

**Rota interna:** `security`
**Componente:** `SecurityAnalysis.tsx`
**Endpoint:** `GET /api/events/stats/security`
**PDF:** `exportSecurityPdf`

### 14 findings classificados por severidade

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

Cada finding exibe: descrição, dados quantitativos, ação recomendada.
Findings com dados (brute force, hangfire, stack traces) exibem tabelas detalhadas.

---

## Página Kong Auth (RF-09)

**Rota interna:** `kong-auth`
**Componente:** `KongAuthAnalysis.tsx`
**Endpoint:** `GET /api/events/stats/kong-auth`
**PDF:** `exportKongAuthPdf`

Eventos com `@MessageTemplate = 'Kong Auth Request'` e `StatusCode != 200` (últimas 4h):
- Métricas: total, falhas, sucessos, falhas 401, falhas 500, taxa de falha
- Detecção de **credential stuffing**: IPs com ≥ 3 usuários distintos em falhas
- Top usuários com falha, top IPs de origem, alerta de IPs internos (RFC 1918)
- Tabela de erros 500 e tabela de falhas recentes (últimas 50)

---

## Página Auth Errors (RF-08)

**Rota interna:** `auth-errors`
**Componente:** `AuthErrorAnalysis.tsx`
**Endpoint:** `GET /api/events/stats/auth-errors`
**PDF:** `exportAuthErrorPdf`

Falhas de `Endpoint: /connect/token` (ResourceOwner) retornando Unauthorized:
- Total de falhas, usuários únicos, pico de erros
- Timeline por hora, top usuários (e-mail + contagem + última ocorrência)
- Top client IDs envolvidos, tabela de eventos recentes
