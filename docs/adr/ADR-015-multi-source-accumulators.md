# ADR-015 — Accumulators especializados por fonte

## Status

Aceito

## Contexto

Inicialmente o Sentinela tinha um único accumulator (`accumulator.ts`, depois renomeado para `seqAccumulator.ts`) responsável por puxar eventos do Seq e alimentar todas as views. Conforme novas demandas chegaram (Kong Auth, Login dashboard, IS4 Events), ficou evidente que um único filtro/accumulator não dá conta:

1. O `seqAccumulator` filtra eventos por `@Level in ['Warning', 'Error', 'Fatal']` para reduzir volume. Logins bem-sucedidos do Kong (`StatusCode 200`) e do IdentityServer4 (`UserLoginSuccess`/`TokenIssuedSuccess`) chegam como `Information` — invisíveis para o accumulator principal.

2. Cada fonte tem dimensões muito diferentes. Misturar `kong_ok / kong_fail` com `auth_failure / error_service:X` no mesmo bucketStore é confuso e dificulta consultas.

3. Filtros únicos com `OR` deixam o `fetchSeq` mais lento e geram dependências cruzadas — ex: o consumidor do Kong não deveria ser afetado por mudança no filtro de auth.

4. Cada fonte tem cadência diferente: WAF (~100 ataques/dia), Audit (~140k eventos/dia), Login (~600 eventos/dia), Seq genérico (>5k erros/dia). Capacidade de paginação e janelas de polling fazem sentido por fonte.

## Decisão

Criamos accumulators especializados, cada um com um source key próprio no `BucketStore`:

- `seqAccumulator` (existente) — eventos genéricos do Seq filtrados por nível
- `kongAccumulator` — só `Kong Auth Request` (Information)
- `loginAccumulator` — multi-source: Kong + `IdentityServer4.Events` + `Erro autenticação`
- `wafAccumulator` (existente) — GoCache
- `auditAccumulator` (existente) — Loki via Grafana
- `infraAccumulator` (existente) — Datadog

Cada accumulator:
- É inicializado por `init<X>Accumulator()` em `app/server.tsx`
- Tem refresh próprio (60 s) com `stopAtId` ou janela de overlap
- Tem backfill 10d em background, sequencial dia-a-dia
- Expõe `getXBucketStore()`, `isXReady()`, `getXSyncProgress()`
- Usa as primitivas compartilhadas `BucketStore` e (opcionalmente) `EventStore`

A função `dimensionsFor<X>Event(e)` é exportada para reuso em drill-downs ao vivo (`getKongAuthStats`, `getLoginOverview`).

## Consequências

- **(+)** Cada feature tem timeline de 10d sem depender da retenção viva do Seq (~6 h).
- **(+)** Filtros por fonte mantém as chamadas pequenas e rápidas. `kongAccumulator` faz ~470 eventos/10d em 8 chamadas paginadas.
- **(+)** `dimensionsForLoginEvent` consegue classificar por `_typeTag` do IS4 (UserLogin/TokenIssued × Success/Failure) sem afetar outros consumidores.
- **(+)** Drift natural — adicionar nova fonte é só criar mais um accumulator + init wiring + server fn.
- **(-)** Mais memória total (~250-300 MB vs ~70 MB do accumulator único). Pod tem limit de 768 MiB, sobra confortável.
- **(-)** Carga adicional no Seq durante backfills paralelos no boot — mitigado pelo backfill ser sequencial (dia-a-dia) e pelos accumulators executarem `await` em série em `server.tsx`.
- **(-)** Alguns eventos podem entrar em mais de um bucket (ex: Kong Auth Request entra no `kongAccumulator` E no `loginAccumulator`). Aceitável — são stores semanticamente diferentes.

## Notas

- O `eventStore` (2 h) é opcional por accumulator. `kongAccumulator` e `loginAccumulator` deliberadamente não têm — drill-down de detalhes vem de `fetchSeq` live (cap 10k eventos / período), o que é suficiente porque a UI mostra apenas top 50 falhas recentes.
- O `loginAccumulator` reaproveita o filtro do `kongAccumulator` (`@Message = 'Kong Auth Request'`) dentro do filtro maior. Portanto, se quisermos sunsetar o `kongAccumulator` no futuro, dá pra derivar Kong stats do `loginAccumulator` via `login_source:kong`.
