# ADR-008: Extração de campos por regex no texto da mensagem

**Status:** Aceito  
**Data:** 2026-04-24  
**Contexto:** Seq Analyzer — como extrair campos de domínio dos logs

---

## Contexto

Os logs do `salesbo` embedam campos importantes no texto da mensagem renderizada em vez de usar propriedades estruturadas separadas:

```
Quote/PrintItens | UserId: 1348383 | GUID_COTACAO: 00000000-0000-0000-0000-000000000000 | Error: Cotação não encontrada
```

```
Erro autenticação | Endpoint: /connect/token (ResourceOwner) | User: contato@taseguroai.com.br | ClientId: salesBackoffice | StatusCode: Unauthorized | Error: Unauthorized
```

Esses campos são críticos para a análise mas não estão em propriedades estruturadas do Seq — estão apenas no texto.

## Opções consideradas

### Opção A: Regex no parser (extração em tempo de ingestão)
Extrair os campos ao receber o evento e guardar em colunas dedicadas do banco.

### Opção B: Regex no PostgreSQL (extração em tempo de query)
Guardar a mensagem bruta e usar `regexp_match()` do PostgreSQL nas queries analíticas.

### Opção C: JSONB no raw_data
Acessar os campos via `raw_data->'Properties'` no banco (apenas funciona para alguns campos nas propriedades estruturadas).

## Decisão

**Opção A para campos primários** (user_id, guid_cotacao):
- Extraídos no parser e guardados em colunas indexadas
- Permitem filtros rápidos com índice B-tree

**Opção B para campos secundários** (email de auth, clientId, statusCode):
- Extraídos via `regexp_match()` no PostgreSQL nas queries de análise
- Evitam adicionar colunas para cada variante de log

```typescript
// Parser — extração primária
export function extractUserId(message: string): string | null {
  return message.match(/UserId:\s*(\d+)/)?.[1] ?? null;
}

export function extractGuidCotacao(message: string): string | null {
  return message.match(/GUID_COTACAO:\s*([0-9a-fA-F-]{36})/)?.[1].toLowerCase() ?? null;
}
```

```sql
-- Query — extração secundária (auth errors)
SELECT
  (regexp_match(message, 'User:\s*(\S+)\s*\|'))[1] AS email,
  COUNT(*) AS count
FROM seq_events
WHERE message ILIKE '%Erro autenticação%'
GROUP BY (regexp_match(message, 'User:\s*(\S+)\s*\|'))[1]
```

## Por que não adicionar colunas para o email de auth?

- Requereria migração de schema
- Apenas um subconjunto de eventos (auth errors) teria o campo preenchido
- O volume de auth errors é baixo — regex no PostgreSQL é suficientemente rápido
- A extração via regex em `GROUP BY` funciona corretamente no PostgreSQL 10+

## Consequências

- O padrão da mensagem é um contrato implícito — se o `salesbo` mudar o formato da mensagem, as regex param de funcionar silenciosamente
- Os campos extraídos por regex em query (`email`, `client_id`) não têm índice — aceitável para o volume atual
- O campo `message_template` (CLEF `@mt`) não está disponível para eventos do endpoint REST → filtros de texto devem sempre usar a coluna `message`
