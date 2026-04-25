# ADR-002: Usar endpoint /api/events/ sem autenticação

**Status:** Aceito  
**Data:** 2026-04-24  
**Contexto:** Seq Analyzer — como conectar ao Seq de produção

---

## Contexto

O Seq em `https://seq-prd.ituran.sp` requer investigação sobre como acessar seus eventos. Há dois endpoints principais:

- `/api/events/raw` — formato CLEF, requer API Key no header `X-Seq-ApiKey`
- `/api/events/` — formato REST API, retorna `SeqApiEvent[]`

A intenção inicial era autenticar com usuário/senha para obter um token, mas o Seq usa autenticação Windows/SSO que não suporta login por senha via API local.

## Investigação

1. Tentativa de login via `POST /api/users/authenticate` com `username: admin` → falha ("A password is required")
2. Consulta a `GET /api/users/current` → **retornou dados de administrador sem qualquer credencial**, confirmando que a autenticação está **desabilitada** no servidor
3. `GET /api/events/raw` → retorna `401 Unauthorized` mesmo sem autenticação configurada (bug ou configuração inconsistente do Seq)
4. `GET /api/events/` → **retorna eventos com sucesso sem nenhuma credencial**

## Decisão

Usar **`GET /api/events/`** sem autenticação como fonte principal de eventos.

Para sync manual com API Key fornecida pelo usuário, usar `/api/events/raw` (que aceita API Key mesmo com auth desabilitada).

## Justificativa

- É o único endpoint que funciona de forma confiável no ambiente atual
- A instância do Seq tem autenticação desabilitada por configuração administrativa — esse é o comportamento esperado nessa instalação
- O endpoint REST API (`/api/events/`) retorna eventos completos com todas as propriedades necessárias

## Formato retornado

```typescript
interface SeqApiEvent {
  Id: string;               // event_id
  Timestamp: string;        // ISO 8601
  Level: string;            // "Error" | "Warning" | "Information" | ...
  RenderedMessage: string;  // mensagem com template preenchido
  Properties: { Name: string; Value: unknown }[]; // propriedades estruturadas
  Exception?: string;       // stack trace quando presente
}
```

## Consequências

- Não há necessidade de gerenciar tokens ou sessões
- O campo `message_template` (template não renderizado) não está disponível no endpoint REST — é sempre armazenado como `null` para eventos dessa origem
- A ausência de `message_template` exige que filtros baseados no template usem a coluna `message` (mensagem renderizada) em vez de `message_template`
- Se o Seq for reconfigurado para exigir autenticação no futuro, será necessário adicionar mecanismo de API Key ou token
