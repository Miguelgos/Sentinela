# ADR-016 — WAF IP rollup + fix do limite GoCache

## Status

Aceito

## Contexto

O Login dashboard ([`specs/login.md`](../specs/login.md)) precisa cruzar IPs do Kong (que tem `ClientIP` real) com o contexto da WAF do GoCache (país, categorias de ataque, ferramentas detectadas, hits bloqueados) — única forma de identificar visualmente IPs que estão tentando login E também atacando aplicação.

Dois obstáculos foram encontrados:

### 1. `wafAccumulator` retornava 0 eventos silenciosamente

O `wafAccumulator` usava `limit: 200` na chamada para `/v1/threat-hub/events`. A API do GoCache rejeita com HTTP 400 e body `{"status_code":-1,"msg":"Limit não pode ser maior que 100."}`. O `httpClient` (`backend/src/lib/httpClient.ts`) **retorna o JSON parseado** sem distinguir 200 vs 4xx, e o `fetchGc` lê `result?.response?.events ?? []` — quando a chamada falha, `result.response` é `undefined`, então `events` vira `[]`. Sem warning, sem erro nos logs. Backfill de 10 d sempre completava com `0 eventos | 0 dims`.

Detectado quando o usuário perguntou "se é o mesmo de prod por que tá zerado?" — uma chamada manual à API mostrou 50+ eventos disponíveis.

### 2. `bucketStore` agrega por dimensão, não por IP

`getWafEventStore()` tem só 2 h de retenção. `getWafBucketStore()` agrega por (dim, minute) — não dá pra perguntar "qual o resumo desse IP nos últimos 10 d?" em O(1).

Bucketizar por IP no `bucketStore` explodiria a cardinalidade (potencialmente milhares de dims).

## Decisão

### Fix do limite

- Constante `PAGE_LIMIT = 100` (cap real da API).
- Pra cobrir dias com volume alto sem perder eventos, paginação por **subdivisão temporal recursiva**: se uma chamada retorna 100 (saturada), divide o intervalo `[from, to]` ao meio e recursa em `[from, mid]` e `[mid, to]` em paralelo. Profundidade máxima 8 (≈256 sub-intervalos por type/dia).
- Dedup no merge por chave `${ip}|${uri}|${timestamp}`, já que `mid` aparece em ambos os lados.

### IP rollup

Adicionado `_ipRollup: Map<string, IpRollupSlot>` no `wafAccumulator`:

```ts
interface IpRollupSlot {
  country: string | null;
  attacks: Map<string, number>;
  tools: Set<string>;
  blocked: number;
  total: number;
  firstSeenMin: number;
  lastSeenMin: number;
}
```

Alimentado em todo `ingest()` via `bumpIpRollup(e, minute)`. Podado a 10 d via `pruneIpRollup(nowMin)` (chamado junto com `rotateTo`).

API pública:

```ts
getWafIpContext(ip: string): WafIpContext | null
getWafIpContextMany(ips: string[]): Record<string, WafIpContext>
```

`getLoginOverview` chama `getWafIpContextMany(topIPs.map(t => t.client_ip))` e enriquece cada entrada com `waf_country`, `waf_attacks`, `waf_tools`, `waf_blocked`, `waf_total`. UI da aba Logins destaca IPs com hits no WAF em vermelho.

## Consequências

### Fix do limite

- **(+)** Após o fix, sync de 10 d em dev passou de 0 → **1.733 eventos / 42 dims / 207 IPs no rollup**.
- **(+)** Aba **GoCache WAF** (que era invisível) agora mostra dados reais.
- **(+)** Subdivisão recursiva pega sem alterar contrato da API, sem cursor/offset (que o GoCache não expõe).
- **(-)** Pode haver chamadas extras para dias de pico (até 256 chamadas / type / dia em pior caso). Volume real não chegou perto disso.

### IP rollup

- **(+)** Correlação O(1) por IP. `getLoginOverview` enriquece 15 IPs em ~zero ms.
- **(+)** Janela de 10 d cobre o seletor de período do dashboard de Logins (1h até 10d).
- **(-)** Memória adicional ~1 MB para ~5k IPs (cada slot ~200 B). Aceitável.
- **(-)** O rollup é "ever seen in 10d" — não filtra por período menor. Se um IP tinha hits no WAF há 9 dias e teve falha de login hoje, vai aparecer destacado mesmo no seletor de 1h. Aceitável: histórico de ataque de IP é informação relevante para SI mesmo fora da janela curta.

## Detecção e prevenção

Bug ficou silencioso porque o `httpClient` deliberadamente retorna `null` em erros para evitar exceções derrubarem o boot. Documentado em [ADR-009](ADR-009-ssl-autoassinado.md). Para evitar repetições:

- Adicionar logging quando `result.response === undefined` em `gcFetch` (TODO).
- Eventualmente migrar `httpClient` para retornar `{ ok, data, error }` em vez de só payload — refactor maior, fora do escopo desta ADR.
