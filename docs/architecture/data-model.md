# Data Model — Stores em memória

O Sentinela usa duas primitivas de armazenamento em memória, compartilhadas pelos vários accumulators (ver [`accumulator.md`](accumulator.md)). Sem disco, sem banco — perde no restart, próximo boot puxa 10 d.

## `BucketStore` — séries temporais densas

`backend/src/timeseries/bucketStore.ts`

Para cada `(source, dimension)` mantém um `Float64Array(REFERENCE_WINDOW_MIN)` indexado circularmente. O slot do minuto M é `(M mod LEN)`. Quando a janela avança 10 dias, o slot do minuto antigo é reescrito pelo novo — sem shift.

### Constantes

| Constante | Valor |
|---|---|
| `REFERENCE_WINDOW_DAYS` | 10 |
| `REFERENCE_WINDOW_MIN` | 14400 (10 × 24 × 60) |
| `EVENT_STORE_WINDOW_MIN` | 120 (2 h) |

### API

| Método | Uso |
|---|---|
| `bump(source, dim, minute, n=1)` | incrementa um slot |
| `bumpMany(source, minute, dims)` | múltiplas dims no mesmo minuto |
| `rotateTo(source, nowMin)` | zera slots fora da janela |
| `getSeries(source, dim, nowMin)` | retorna `TimeSeries { dimension, buckets: Map<minute, count> }` (apenas slots > 0) |
| `getDimensions(source)` | lista nomes de dims registradas |

### Memória

~1 KB por (source, dim) × N dims. Total: ~6 MB para todos os accumulators combinados.

## `EventStore<T>` — buffer rolante de eventos brutos

`backend/src/timeseries/eventStore.ts`

Mantém `Map<source, Map<eventId, { event, timestamp }>>`. Janela de 2 h por padrão.

### API

| Método | Uso |
|---|---|
| `put(source, eventId, event, timestamp)` | grava evento |
| `putMany(source, items[])` | batch |
| `get(source, eventId)` | drill-down por ID |
| `list(source, sinceMinute?)` | retorna eventos ordenados desc |
| `pruneToWindow(source, nowMin)` | remove eventos > 2 h |

### Quem usa

- `seqAccumulator` — eventos do Seq pra LogsTable / EventDetail
- `wafAccumulator` — GcEvents pra UI
- `auditAccumulator` — eventos do Loki

`kongAccumulator` e `loginAccumulator` **não** usam `EventStore` — drill-down é feito via `fetchSeq` live.

## `_ipRollup` — exceção do `wafAccumulator`

`Map<ip, { country, attacks, tools, blocked, total, firstSeen, lastSeen }>` mantido por 10 d, alimentado em todo `ingest()`. Permite correlação O(1) por IP sem varrer eventos.

API pública: `getWafIpContext(ip)`, `getWafIpContextMany(ips[])`. Consumida pelo `getLoginOverview` para enriquecer top IPs do Kong com contexto WAF.

## `StoredEvent` (Seq)

```ts
type ParsedEvent  = ReturnType<typeof parseSeqApiEvent>;
type StoredEvent  = Omit<ParsedEvent, "raw_data"> & {
  raw_data: { Properties: SeqApiEvent["Properties"] };
};
```

| Campo | Origem |
|---|---|
| `event_id` | `Id` do Seq |
| `timestamp` | `Timestamp` (ISO 8601) |
| `message` | `RenderedMessage` |
| `level` | `Level` (Warning/Error/Fatal/Critical) |
| `trace_id` | property `TraceId` ou `@tr` ou `@@tr` |
| `user_id` | regex `UserId:\s*(\d+)` no message ou property `UserId` |
| `guid_cotacao` | regex `GUID_COTACAO:\s*<guid>` ou property ou QueryString |
| `service` | property `dd_service` ou `Application` |
| `environment` | property `dd_env` ou `Environment` |
| `request_path` | property `RequestPath` |
| `source_context` | property `SourceContext` |
| `raw_data.Properties` | array Properties original do Seq (pra `prop()` em `seq.ts`) |

`compactEvent(p)` na ingestão troca `raw_data` (objeto Seq inteiro) por `{ Properties }`. Reduz ~19 KB → ~5 KB por evento.

## Por que não persistir?

- Seq é a fonte canônica — refazer sync em ~3 min no boot é aceitável.
- Sem banco, sem migration, sem ops.
- Decisão histórica em [ADR-010](../adr/ADR-010-sqlite-in-memory.md).
