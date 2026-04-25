# ADR-004: Suporte a dois formatos de evento Seq

**Status:** Aceito  
**Data:** 2026-04-24  
**Contexto:** Seq Analyzer — parsing de eventos

---

## Contexto

O Seq expõe eventos em dois formatos distintos dependendo do endpoint usado:

### Formato 1: CLEF (Compact Log Event Format)
Usado pelo endpoint `/api/events/raw` e em exports manuais do Seq:

```json
{
  "@t": "2026-04-25T02:06:13.4660183Z",
  "@mt": "Quote/PrintItens | UserId: {UserId} | GUID_COTACAO: {GuidCotacao}",
  "@m": "Quote/PrintItens | UserId: 1348383 | GUID_COTACAO: 00000000-...",
  "@i": "0d8fc564",
  "@l": "Error",
  "@@tr": "b58eb01795c192f7e92d289c05830b58",
  "@@sp": "a1572fe12343f2ab",
  "dd_service": "salesbo",
  "dd_env": "integra-prd",
  "SourceContext": "...",
  "RequestPath": "/Quote/PrintItens"
}
```

### Formato 2: Seq REST API
Usado pelo endpoint `/api/events/` (sem autenticação):

```json
{
  "Id": "event-abc123",
  "Timestamp": "2026-04-25T02:06:13.4660183Z",
  "Level": "Error",
  "RenderedMessage": "Quote/PrintItens | UserId: 1348383 | GUID_COTACAO: 00000000-...",
  "Properties": [
    { "Name": "dd_service", "Value": "salesbo" },
    { "Name": "RequestPath", "Value": "/Quote/PrintItens" },
    { "Name": "TraceId", "Value": "b58eb01795c192f7e92d289c05830b58" }
  ]
}
```

## Decisão

Implementar **dois parsers separados** que produzem o mesmo tipo normalizado:

- `parseSeqEvent(raw: RawSeqEvent)` — para formato CLEF
- `parseSeqApiEvent(e: SeqApiEvent)` — para formato REST API

Ambos retornam o mesmo shape de objeto para inserção no banco.

## Diferenças críticas entre os parsers

| Campo | CLEF (`parseSeqEvent`) | REST API (`parseSeqApiEvent`) |
|-------|----------------------|------------------------------|
| `message_template` | `@mt` | `null` (não disponível) |
| `message` | `@m` ou `@mt` | `RenderedMessage` |
| `event_id` | `@i` | `Id` |
| `level` | `@l` | `Level` |
| `trace_id` | `@@tr` | `Properties[TraceId]` |
| Campos extras | Flat no objeto | Array `Properties[{Name,Value}]` |

## Consequências

- Filtros baseados em `message_template` (template não renderizado) só funcionam para eventos CLEF
- Eventos importados via sync do `/api/events/` têm `message_template = null` — filtros devem usar `message`
- Isso causou o bug na análise de auth errors: o filtro `message_template ILIKE '%Erro autenticação%'` não retornava nada → corrigido para filtrar em `message`
- Ambos os formatos coexistem no banco (importação manual CLEF + sync automático REST API)
