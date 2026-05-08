# Spec — Logins (Visão Consolidada)

**Rota interna:** `logins`
**Componente:** `LoginAnalysis.tsx`
**Server function:** `getLoginOverview(period)` em `app/server/fn/events.ts`
**PDF:** não tem (planejado em fase futura)

## Contexto

Demanda da equipe de SI: ter visibilidade unificada de **todos os logins** (sucesso e falha, dentro e fora da WAF), em vez de informação dispersa em `Auth Errors`, `Kong Auth` e `GoCache WAF` separadamente.

A aba **Logins** consolida quatro fontes de autenticação que vivem em `Information` no Seq (fora do `LEVEL_FILTER` do `seqAccumulator`) e correlaciona com a WAF do GoCache para enriquecer o contexto de IPs.

## Sources cobertos

| Source            | Mensagem / Filtro                                       | Sucesso | Falha | User | IP real |
|-------------------|---------------------------------------------------------|:-:|:-:|:-:|:-:|
| `kong`            | `@Message = 'Kong Auth Request'`                        | StatusCode 200 | ≠ 200 | ✓ | ✓ `ClientIP` |
| `is_web`          | IS4 Events `_typeTag = UserLoginSuccess/FailureEvent`   | EventType=Success | EventType=Failure | ✓ Username | ✗ (LB interno) |
| `is_api`          | IS4 Events `_typeTag = TokenIssuedSuccess/FailureEvent` | EventType=Success | EventType=Failure | (SubjectId) | ✗ |
| `auth_common`     | `Contains(@Message, 'Erro autenticação')`               | — | sempre falha | ✓ User | ✗ |

> **IP real** só está disponível no Kong (gateway). IS4 e Auth Common não logam o IP do cliente final — só LB interno (descartado). Por isso a correlação WAF acontece **apenas** sobre IPs vindos do Kong.

## Funcionalidades

### Stat cards (período selecionado)

- Total Logins
- Sucesso (`login_ok`)
- Falha (`login_fail`)
- Taxa de Falha (%)
- IPs Internos (10.x / 192.168.x / 172.16-31.x — só Kong)
- IPs Externos
- Breakdown por fonte: Kong / IS Web / IS Token API / Auth Common

### Timeline empilhada por fonte

10d via `loginBucketStore`. Áreas empilhadas com cores:
- 🔵 Kong (`#3b82f6`)
- 🟣 IS Web (`#a855f7`)
- 🩵 IS Token API (`#06b6d4`)
- 🟠 Auth Common (`#f59e0b`)

### Motivos de falha

Tabela com contagem por categoria:
- `invalid_credentials` (UserLoginFailure com `Message: invalid_username_or_password`)
- `invalid_grant` (TokenIssuedFailure com `Error: invalid_grant`)
- `unauthorized` (Kong 401, IS `Error: unauthorized_client`)
- `server_error` (Kong 500)
- `other`

### Top usuários (cross-source)

Username + falhas + sucessos + **badges das fontes** onde apareceu + último timestamp. Detecta usuários que estão tropeçando em mais de uma fonte (ex: falhando no Kong **e** no IS).

### Top IPs (Kong only) com correlação WAF

Para os top 15 IPs com mais falhas no Kong, cruza com `wafAccumulator._ipRollup` (10d, ver `architecture/accumulator.md`):

- País (`country_code` da WAF)
- Categorias de ataque detectadas (`SQLi×3, XSS×1, PathTraversal×2, ...`)
- Ferramentas detectadas (SQLMap, Nikto, Python, etc — filtra Browser/Other)
- Total de bloqueios da WAF
- Linha em **vermelho destacado** quando o IP tem qualquer hit no WAF

### Falhas Recentes (últimas 50)

Tabela: timestamp, fonte (badge), username, IP, ClientId, motivo. Fonte vivos do Seq via `fetchSeq` (cap retenção viva, ~6h).

## Backend

### Accumulator: `loginAccumulator.ts`

- Source key: `login`
- Filter único combinado: `(@Message = 'Kong Auth Request') or (Contains(@SourceContext, 'IdentityServer4.Events')) or (Contains(@Message, 'Erro autenticação'))`
- Refresh 60s incremental (via `stopAtId`)
- Backfill 10d, max 100k eventos/dia
- Sem `EventStore` próprio — drill-down de eventos vem do `fetchSeq` live

### Dimensões geradas no `bucketStore`

```
login_total
login_ok
login_fail
login_source:{kong|is_web|is_api|auth_common}
login_class:{internal|external}            ← só Kong (IP real)
login_fail_reason:{invalid_credentials|invalid_grant|unauthorized|server_error|other}
```

### Server fn `getLoginOverview(period)`

- Summary + timeline saem do `loginBucketStore` (10d, sem cap)
- Top users / top IPs / falhas recentes saem do `fetchSeq` live (cap 10k eventos / período)
- Top IPs enriquecidos via `getWafIpContextMany(ips)` do `wafAccumulator`

## Limitações conhecidas

- **WAF correlation depende de IP do Kong**: logins via IS Web/API ou Auth Common não cruzam com WAF.
- **Drill-downs (top users/IPs/falhas recentes) cobrem só ~6h** da retenção viva do Seq, mesmo quando o seletor está em 10d. Stat cards e timeline cobrem 10d via bucket.
- **`auth_common` é sempre falha** — não há equivalente "Erro autenticação OK". Sucessos do Authentication Common ficam invisíveis (apps não logam o sucesso por padrão).

## Decisões relacionadas

- [ADR-015](../adr/ADR-015-multi-source-accumulators.md) — accumulators especializados por fonte
- [ADR-016](../adr/ADR-016-waf-ip-rollup.md) — IP rollup do WAF + fix do limite GoCache
