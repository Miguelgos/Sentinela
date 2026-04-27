# Seq Polling — Accumulator

## Visão geral

`backend/src/accumulator.ts` é o único componente que faz polling no Seq. Ele roda em loop
contínuo a cada 60 segundos e popula o `Map<string, ParsedEvent>` que serve todas as queries
de stats do backend.

## Fluxo de polling

```
accumulator.ts (60s loop)
  │
  ├─ seq.ts: GET /api/events/?count=1000&signal=signal-m33301&render=true[&afterId=...]
  │      └─ Seq retorna array de SeqApiEvent (CLEF)
  │
  ├─ Para cada página:
  │      ├─ parseSeqApiEvent() → extrai campos normalizados
  │      ├─ Se encontrar _latestSeqId na página → pára (polling incremental)
  │      └─ Adiciona evento ao Map (chave: event_id)
  │
  ├─ Atualiza _latestSeqId com o evento mais recente visto
  │
  └─ TTL drop: remove eventos com timestamp < now() - 7d
```

## Parâmetros do Seq

| Parâmetro | Valor | Descrição |
|-----------|-------|-----------|
| `count` | 1000 | Eventos por página |
| `signal` | `signal-m33301` | Apenas erros do salesbo |
| `render` | `true` | Retorna `@m` renderizado |
| `afterId` | `_latestSeqId` | Paginação incremental |

## Cursor opcional (apenas em dev)

Habilitado via `SNAPSHOT_PATH` (ausente em prod — k8s não monta volume):

```ts
// Salvo em SIGTERM/SIGINT; restaurado no boot
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH;
// Conteúdo: { savedAt, latestSeqId, events[] }
```

Em prod, o catch-up inicial (desde `now() - 7d`) demora ~17s típico. O `readinessProbe` do k8s
tolera esse tempo (`startupProbe` com `failureThreshold: 30, periodSeconds: 5`).

## Throttling

Para reduzir rajada de GETs no Seq durante catch-up: `await sleep(50)` entre páginas.
O Seq usa licença single-user — ver risco 9.3 em `docs/refactor-plan.md`.

## Health endpoint

`GET /api/health` (ou `/sentinela/api/health` com basepath):
- Retorna **503** enquanto `isReady() === false` (catch-up em andamento)
- Retorna **200** com `{ ready: true, storeSize, coverage }` após primeiro ciclo completo
