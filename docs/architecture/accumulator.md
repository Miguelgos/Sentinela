# Accumulators — stores de eventos em memória

O Sentinela mantém vários accumulators independentes em memória, cada um responsável por uma fonte de dados. Todos seguem o mesmo padrão de **boot não-bloqueante** (refresh imediato + backfill em background) e usam dois primitivos compartilhados:

- **`BucketStore`** (`backend/src/timeseries/bucketStore.ts`) — séries temporais densas em `Float64Array` circulares, 10 dias × N dimensões. Memória predizível (~6 MB total).
- **`EventStore<T>`** (`backend/src/timeseries/eventStore.ts`) — buffer rolante de 2h de eventos brutos pra drill-down de UI. Não é usado por detectores.

Cada accumulator escolhe se quer só `BucketStore` (puro time-series) ou ambos (com drill-down ao vivo).

## Pattern compartilhado

```
init<X>Accumulator()
  ├─ setInterval(refresh, 60s)           ← incrementa diff via stopAtId / overlap temporal
  └─ syncFullHistory()  (background)     ← popula 10 dias dia-a-dia, sequencial
```

Servidor HTTP responde imediatamente no boot. Frontend acompanha via banner de progresso enquanto `phase === "syncing"`.

## Accumulators ativos

### `seqAccumulator` (`backend/src/accumulators/seqAccumulator.ts`)

- **Source key:** `seq`
- **Fonte:** Seq, filtrado por `@Level in ['Warning', 'Error', 'Fatal']` (mais `NOISE_SOURCES` excluído)
- **Stores:** `BucketStore` (10d) + `EventStore` (2h)
- **Dimensões:** `total`, `service:X`, `error_service:X`, `error_endpoint:Y`, `auth_failure`
- **Consumidores:** anomaly detector, dashboards de eventos genéricos, `getAuthErrorStats`

### `kongAccumulator` (`backend/src/accumulators/kongAccumulator.ts`)

- **Source key:** `kong`
- **Fonte:** Seq filtrado por `@Message = 'Kong Auth Request'` (Information, fora do `LEVEL_FILTER` do `seqAccumulator`)
- **Stores:** só `BucketStore` (drill-down via `fetchSeq` live)
- **Dimensões:** `kong_total`, `kong_ok`, `kong_fail`, `kong_fail_401`, `kong_fail_500`
- **Consumidor:** `getKongAuthStats` (timeline 10d)

### `loginAccumulator` (`backend/src/accumulators/loginAccumulator.ts`)

- **Source key:** `login`
- **Fonte:** Seq filtrado por filter único combinado (Kong Auth Request OR IS4 Events OR `'Erro autenticação'`)
- **Stores:** só `BucketStore`
- **Dimensões:** `login_total`, `login_ok`, `login_fail`, `login_source:{kong|is_web|is_api|auth_common}`, `login_class:{internal|external}` (só Kong), `login_fail_reason:{...}`
- **Consumidor:** `getLoginOverview` (aba **Logins**, ver [`specs/login.md`](../specs/login.md))

### `wafAccumulator` (`backend/src/accumulators/wafAccumulator.ts`)

- **Source key:** `waf`
- **Fonte:** GoCache `/v1/threat-hub/events` (WAF + bot-mitigation + firewall)
- **Stores:** `BucketStore` + `EventStore` (2h) + **`_ipRollup`** (Map per-IP, 10d) — única exceção do padrão
- **Dimensões:** `total`, `type:{waf|bot|firewall}`, `attack:{SQLi|XSS|...}`, `country:{cc}`, `tool:{SQLMap|...}`, `blocked`
- **`_ipRollup`:** mapa `IP → {country, attacks, tools, blocked, total, firstSeen, lastSeen}` — alimentado em todo `ingest()`, podado a 10d. Permite correlação O(1) por IP sem varrer eventos
- **API pública:** `getWafBucketStore`, `getWafEventStore`, `getWafIpContext(ip)`, `getWafIpContextMany(ips[])`

### `auditAccumulator` (`backend/src/accumulators/auditAccumulator.ts`)

- **Source key:** `audit`
- **Fonte:** Loki via Grafana proxy (datasource `integra-audit`), serviços integra/customer360/fieldservice
- **Stores:** `BucketStore` + `EventStore` (2h)
- **Volume típico:** 130k+ eventos/dia, 46+ dimensões
- **Consumidor:** `getAuditOverview`

### `infraAccumulator` (`backend/src/accumulators/infraAccumulator.ts`)

- **Source key:** `infra`
- **Fonte:** Datadog (incidents + monitor states)
- **Janela:** cresce gradual até 10d (sem backfill explícito, só polling)

## Pattern de ingest

```ts
// Cada accumulator implementa:
function ingest(events: T[]): void {
  const byMinute = new Map<number, Record<string, number>>();
  for (const e of events) {
    const dims = dimensionsFor<X>Event(e);
    const minute = tsToMinute(e.timestamp);
    accumulate(byMinute, minute, dims);
  }
  for (const [minute, dims] of byMinute) {
    bucketStore.bumpMany(SOURCE, minute, dims);
  }
  // opcional: eventStore.putMany() pra drill-down
  // opcional: bumpIpRollup() (waf)
}
```

## Boot wiring

`app/server.tsx` chama os `init*Accumulator()` em sequência ao subir o handler do TanStack Start:

```ts
await initAccumulator().catch(console.error);          // seq
await initWafAccumulator().catch(console.error);
await initAuditAccumulator().catch(console.error);
await initInfraAccumulator().catch(console.error);
await initKongAccumulator().catch(console.error);
await initLoginAccumulator().catch(console.error);
```

## Memória estimada

| Componente | Tamanho |
|---|---|
| `BucketStore` (1 source × 50 dims × 10d) | ~6 MB |
| `EventStore` (Seq, ~50k eventos × 4 KB compactos) | ~200 MB cap |
| `_ipRollup` WAF (~5k IPs × ~200 B) | ~1 MB |
| **Total estimado** | **~250-300 MB** |

Pod tem limit de 768 MiB. Sobra confortável.

## Observação sobre licença Seq

Seq tem licença com cota de requests. Os handlers que **não** usam o bucketStore e batem direto no Seq pra drill-down (`getAuthErrorStats`, `getKongAuthStats`, `getLoginOverview`) passam por `memoizeSeq` (TTL 5 min) — independente de quantos usuários abrirem o dashboard, é 1 request a cada 5 min por handler.

## Sync progress / health

`getSyncProgress()` (Seq), `getWafSyncProgress()`, `getAuditSyncProgress()`, `getKongSyncProgress()`, `getLoginSyncProgress()` retornam `{ phase, startedAt, finishedAt, loaded, error }`. Frontend agrega no `SyncBanner.tsx`.
