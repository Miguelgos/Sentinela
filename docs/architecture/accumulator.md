# Accumulator — store de eventos do Seq

`backend/src/accumulator.ts` mantém em memória os eventos do Seq dos últimos 7 dias. É o único componente que faz polling no Seq — todas as queries do dashboard (`listEvents`, `getStatsSummary`, `getTimeline`, parte do `getThreatReport`) leem deste store.

## Boot (não-bloqueante)

```
initAccumulator()
  ├─ setInterval(refresh, 60s)           ← ativo desde o segundo zero
  └─ syncFullHistory()  (background)     ← popula 7 dias em chunks de 1d
```

Servidor HTTP responde imediatamente. Frontend vê store crescer via `getEventsStatus` (refetch 5s) e mostra `SyncBanner` enquanto `phase === "syncing"`.

## Refresh (60s)

Pega últimos 500 eventos com `signal-m33301` + `@Level in ['Warning','Error','Fatal']`, para no `_latestSeqId` da última iteração, adiciona novos ao Map. Em seguida aplica retenção 7d e cap 100k.

## Sync inicial

Itera 7 dias do mais recente ao mais antigo. Cada chunk usa `fromDateUtc`/`toDateUtc` no Seq, paginação com `afterId`, max 50k eventos por dia. Atualiza `_syncProgress.daysDone` a cada chunk.

## Cap e compactação

- `MAX_EVENTS = 100_000` — quando excede, descarta os mais antigos.
- `compactEvent(p)` — ao armazenar, troca `raw_data` (objeto Seq inteiro) por `{ Properties }`. Reduz ~19 KB → ~5 KB por evento. 100k cabem em ~400 Mi (limit 768 Mi do pod).

## Filtros

- `LEVEL_FILTER = "@Level in ['Warning', 'Error', 'Fatal']"` — descarta Information/Debug
- `NOISE_SOURCES` — descarta Warnings de fontes ruidosas (IdentityServer, ForwardedHeaders, HttpClient, Routing). Errors/Critical destas fontes são mantidos.

## API exposta

| Função | Uso |
|---|---|
| `getEvents()` | retorna `StoredEvent[]` (sorted desc por timestamp) |
| `storeSize()` | tamanho atual do Map |
| `storeCoverage()` | `{ oldest, newest }` |
| `getSyncProgress()` | `{ phase, daysDone, daysTotal, loaded, ... }` |
| `isReady()` | `phase === "done"` |

## Observação sobre licença Seq

O Seq tem licença com limite de requests. Os 2 handlers que **não** usam o accumulator e batem direto no Seq (`getAuthErrorStats`, `getKongAuthStats` em `app/server/fn/events.ts`) passam por `memoizeSeq` (TTL 5 min) — independente de quantos usuários abrirem o dashboard, é 1 request a cada 5 min por handler.
