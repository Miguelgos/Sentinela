# ADR-005: SQL Server para lookup de nomes de usuário

**Status:** Aceito  
**Data:** 2026-04-24  
**Contexto:** Seq Analyzer — enriquecimento de dados de usuário

---

## Contexto

Os eventos do `salesbo` identificam usuários pelo campo `UserId` (um número inteiro). Para tornar a análise mais útil — especialmente ao investigar quem está gerando erros — é necessário mostrar o nome real da pessoa.

O banco `ituranweb` no SQL Server `BRSPO1IDB11.ITURAN.SP\INTEGRA_ESPELHO` contém a tabela `pessoa` com a coluna `nm_pessoa` indexada por `cd_pessoa`. O `user_id` nos logs é exatamente o `cd_pessoa`.

## Decisão

Conexão separada ao SQL Server usando o pacote `mssql` com a seguinte configuração:

```typescript
const config: sql.config = {
  server: "BRSPO1IDB11.ITURAN.SP",
  database: "ituranweb",
  user: "ituranweb",
  password: "ituranpwd",
  options: {
    instanceName: "INTEGRA_ESPELHO",
    trustServerCertificate: true,
    connectTimeout: 5000,
    requestTimeout: 5000,
  },
};
```

O lookup é feito via query parametrizada com `IN` clause:

```sql
SELECT cd_pessoa, nm_pessoa
FROM pessoa
WHERE cd_pessoa IN (...)
```

## Por que não cachear no PostgreSQL?

- Os dados de `nm_pessoa` mudam raramente mas podem mudar
- Adicionar uma tabela de cache requereria lógica de invalidação
- O lookup é feito por batch (todos os user_ids de uma página de uma vez) — latência aceitável

## Endpoints expostos

- `GET /api/pessoa/lookup?userIds=1348383,1348384` → `{ "1348383": "DIDI & MARQUES...", "1348384": "..." }`
- `GET /api/pessoa/stats` → lista de usuários com contagem de eventos, erros e eventos com GUID vazio

## Consequências

- Dependência de rede à rede interna da Ituran para acessar o SQL Server
- Se o SQL Server estiver indisponível, os nomes não são exibidos mas os eventos continuam funcionando (degradação graciosa — a UI exibe "—" quando o lookup falha)
- A instância nomeada `INTEGRA_ESPELHO` requer `instanceName` em vez de porta no driver `mssql`
- Timeout curto (5s) para não bloquear a UI quando o SQL Server está lento
