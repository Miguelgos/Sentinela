# Data Model — Eventos no store

`accumulator.ts` mantém `Map<string, StoredEvent>` indexado pelo `event_id` do Seq. Sem disco, sem banco — perde no restart (próximo boot puxa 7 d).

## Tipos

```ts
// Tipo durante fetch/parse — raw_data é o objeto Seq inteiro
type ParsedEvent = ReturnType<typeof parseSeqApiEvent>;

// Tipo armazenado no Map — raw_data compactado pra economizar RAM
type StoredEvent = Omit<ParsedEvent, "raw_data"> & {
  raw_data: { Properties: SeqApiEvent["Properties"] };
};
```

## Campos do `StoredEvent`

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

## Retenção

- **7 d rolante**: a cada `refresh()`, eventos com `timestamp < now() - 7d` são removidos do Map.
- **Cap 100 k**: quando o store ultrapassa, descarta os mais antigos por timestamp.

Volume atual: ~65 k eventos / 7 d (vide logs do pod, varia conforme tráfego e bursts de erro).

## Por que não persistir?

- Seq é a fonte canônica — refazer sync em ~3 min no boot é aceitável.
- Sem banco, sem migration, sem ops.
- Decisão histórica em [ADR-010](../adr/ADR-010-sqlite-in-memory.md).
