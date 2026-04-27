# Modelo de Dados

## Store in-memory (atual e pós-Fase 1)

`accumulator.ts` mantém um `Map<string, ParsedEvent>` com todos os eventos dos últimos 7 dias.
A chave é o `event_id` do Seq. Nenhum disco é necessário em produção.

**Janela de retenção:** 7 dias (TTL rolante — eventos com `timestamp < now() - 7d` são removidos
a cada ciclo de polling). Decisão validada por Segurança em 2026-04-26 (nenhuma rota consulta
além de 7d — teto em `routes/events.ts:111`).

## ParsedEvent (Map in-memory)

| Campo | Tipo | Origem |
|-------|------|--------|
| `event_id` | string | ID do evento no Seq (`@id` no CLEF) |
| `timestamp` | string | `@t` do Seq (ISO 8601) |
| `message_template` | string | `@mt` do Seq |
| `message` | string | Mensagem renderizada |
| `level` | string | `@l` — Error / Warning / Information |
| `trace_id` | string | `@tr` |
| `span_id` | string | `@sp` |
| `user_id` | string | Extraído por regex de `message` |
| `guid_cotacao` | string | Extraído por regex de `message` |
| `service` | string | `dd_service` |
| `environment` | string | `dd_env` |
| `request_path` | string | `RequestPath` do Serilog |
| `source_context` | string | `SourceContext` do Serilog |
| `raw_data` | object | Evento completo (para Kong Auth e drill-down) |

## seq_events (SQLite — removido na Fase 1)

Antes da Fase 1, eventos eram persistidos em `data/events.db` com retenção em dois tiers:
- **Tier A** (Error, security findings, auth failures): 90 dias
- **Tier B** (informativos): 7 dias

Após a Fase 1, a retenção é unificada em 7 dias e o SQLite é removido.
Ver ADR-010 (`docs/adr/ADR-010-sqlite-in-memory.md`) para justificativa.

## Lookup de pessoa (SQL Server)

`db/mssql.ts` consulta `ituranweb` (named instance `INTEGRA_ESPELHO` em
`BRSPO1IDB11.ITURAN.SP`):

```sql
SELECT cd_pessoa, nm_pessoa
FROM pessoa
WHERE cd_pessoa IN (@ids)
```

`user_id` dos eventos do Seq é o `cd_pessoa` (inteiro). O lookup enriquece a UI com `nm_pessoa`.
Pré-load no boot + refresh diário (alvo pós-Fase 2).
