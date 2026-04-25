# Relatório de Segurança — Análise de Logs salesbo / integra-prd

**Gerado em:** 2026-04-25  
**Janela analisada:** 2026-04-25 01:17 → 02:23 UTC (≈ 66 minutos)  
**Total de eventos:** 1.091 (939 Error + 152 Critical)  
**Sinal:** `signal-m33301`

---

## Resumo Executivo

| Severidade | Achados |
|-----------|---------|
| 🔴 Crítico | 2 |
| 🟠 Alto | 3 |
| 🟡 Médio | 4 |
| 🟢 Baixo | 2 |

A análise identificou evidências de **ataques de credential stuffing / força bruta** contra dois endpoints de autenticação, **IdentityServer4 com exceções não tratadas**, **Swagger habilitado em produção**, e **stack traces internos expostos nos logs** de múltiplos serviços.

---

## 🔴 CRÍTICO — SEC-001: Possível Credential Stuffing em larga escala

**Endpoint:** `POST /v1/Autenticacao/FazerAutenticacao`  
**ClientId:** `customerAreaApp`  

### Dados

- **142 falhas** de autenticação em 66 minutos
- **65 usuários únicos** distintos falhando
- Todos com erro: `ExcecaoAcessoNegado`

### Padrão de ataque (tentativas rápidas em < 5 min)

| Usuário | Tentativas | Janela | Freq. (req/min) |
|---------|-----------|--------|-----------------|
| `Joaobg` | 3 | 6s | **38,9 req/min** |
| `Ivan.d.dasilva@hotmail.com` | 3 | 12s | 14,6 req/min |
| `elisangelapinentel@gmail.com` | 5 | 23s | 13,1 req/min |
| `tatymsp@hotmail.com` | 5 | 26s | 11,7 req/min |
| `barretorodrigo1406@gmail.com` | 3 | 20s | 8,9 req/min |
| `deisess2.9@gmail.com` | 3 | 26s | 7,0 req/min |
| `ronaldo@ottamark.com.br` | 5 | 47s | 6,3 req/min |
| `izes_senhorarocha@hotmaol.com` | 4 | 41s | 5,8 req/min |

### Análise

- A frequência de `Joaobg` (38,9 req/min) é fisicamente impossível de ser humano digitando — indica automação
- 65 usuários diferentes em 66 minutos com o mesmo padrão de falha é consistente com **credential stuffing** (lista de credenciais vazadas sendo testada)
- `izes_senhorarocha@hotmaol.com` — erro de digitação no domínio (`hotmaol` em vez de `hotmail`) — típico de dados de listas de credenciais roubadas
- Não há evidência de rate limiting ou bloqueio automático nos logs

### Recomendações

1. **Implementar rate limiting** no endpoint `/v1/Autenticacao/FazerAutenticacao` (ex: máx. 5 tentativas/5 min por IP ou usuário)
2. **Implementar account lockout** após N falhas consecutivas
3. **Alertar em tempo real** quando >= 3 falhas do mesmo usuário em < 1 minuto
4. **Investigar o IP de origem** dos usuários com taxa > 5 req/min — não capturado nos logs atuais

---

## 🔴 CRÍTICO — SEC-002: IdentityServer4 com Exceções Não Tratadas (Critical)

**Endpoint:** `POST /connect/token`  
**Source context:** `IdentityServer4.Hosting.IdentityServerMiddleware`

### Dados

- **152 eventos Critical** no endpoint `/connect/token`
- Mensagem registrada: `Unhandled exception:` (sem detalhes adicionais no log)
- O IdentityServer4 está terminando requisições com exceção não tratada

### Análise

- Exceções `Unhandled` no middleware do IdentityServer4 podem expor stack traces ao cliente se o tratamento de erro não estiver configurado corretamente
- O volume (152 em 66 min = 2,3/min) sugere que está ocorrendo de forma sistemática
- A ausência de detalhes na mensagem de log indica que a exceção está sendo capturada antes do log completo — o que pode mascarar a causa raiz

### Recomendações

1. **Investigar a causa raiz**: habilitar logging detalhado no IdentityServer4 para capturar a exception completa
2. **Garantir que o middleware de erro retorne RFC 7807** (Problem Details) sem expor stack trace ao cliente
3. **Verificar se o endpoint `/connect/token` está retornando 500** ao invés de 401/400 corretos

---

## 🟠 ALTO — SEC-003: Swagger/OpenAPI habilitado em Produção

**Serviços afetados:** `Ituran.AreaClientes.Aplicacao`, `Ituran.Modulo.Core.API`

### Evidência

Stack traces nos logs mostram o middleware do Swagger na cadeia de execução:

```
at Swashbuckle.AspNetCore.SwaggerUI.SwaggerUIMiddleware.Invoke(HttpContext httpContext)
at Swashbuckle.AspNetCore.Swagger.SwaggerMiddleware.Invoke(HttpContext httpContext, ISwaggerProvider swaggerProvider)
```

### Análise

- O Swagger UI e o Swagger JSON (`/swagger/v1/swagger.json`) estão acessíveis em `integra-prd`
- Expõe **mapa completo de todos os endpoints** da API, incluindo parâmetros, schemas e exemplos
- Facilita enormemente a enumeração de endpoints e o planejamento de ataques
- Especialmente problemático combinado com os ataques de autenticação identificados em SEC-001

### Recomendações

```csharp
// Em Program.cs / Startup.cs:
if (app.Environment.IsDevelopment())  // SOMENTE em desenvolvimento
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
```

---

## 🟠 ALTO — SEC-004: Stack Traces Internos Expostos nos Logs (Risco de Vazamento)

**Serviços afetados:** `Ituran.AreaClientes.Aplicacao`, `Ituran.Modulo.Core.API`

### Evidência

Os logs contêm stack traces completos com caminhos internos de código:

```
at Ituran.AreaClientes.Aplicacao.Controllers.V1.PagamentoController.GetPendingFinancialClient(...)
   in /src/src/modules/customer/Ituran.AreaClientes.Aplicacao/Controllers/V1/PagamentoController.cs:line 355
at partner.api.Framework.BaseController.get_CD_PESSOA_PARCEIRO()
```

**Endpoints com stack traces:**
- `/v1/Pagamento/GerarCobranca` — 53 erros
- `/v1/Pagamento/ListarPendenciasFinanceirasCliente` — 11 erros (erro em `BloquearPagamentoVeiculoConectado`)
- `/v2/cadastro` — 7 erros (falha em `CadastroController.Criar` sem tratar `get_CD_PESSOA_PARCEIRO()`)

### Análise

- Se esses stack traces são **retornados ao cliente** (não apenas logados), violam OWASP A05:2021 (Security Misconfiguration)
- Expõem: estrutura de diretórios de código (`/src/src/modules/...`), nomes de classes e métodos internos, números de linha
- A mensagem de erro do `GerarCobranca` é exibida ao usuário: _"Prezado cliente, seu boleto não pôde ser gerado. Entre em contato..."_ — esse texto sugere que há um tratamento de UI mas a exception pode vazar em outros paths
- O `get_CD_PESSOA_PARCEIRO()` falhando no `CadastroController` indica um acesso a claim de autenticação antes de validar se a claim existe — possível bypass de validação

### Recomendações

1. **Nunca retornar stack trace ao cliente** — usar middleware de erro global que retorna mensagem genérica
2. **Tratar `get_CD_PESSOA_PARCEIRO()` defensivamente** — validar claim antes de usar
3. **Verificar o endpoint `/v2/cadastro`**: a falha em `get_CD_PESSOA_PARCEIRO` pode indicar que requisições não autenticadas estão chegando até o controller

---

## 🟠 ALTO — SEC-005: Username no formato CNPJ tentando autenticar

**Endpoint:** `/v1/Autenticacao/FazerAutenticacao`  
**Username:** `62429637000155`

### Análise

- `62429637000155` é um número de CNPJ (14 dígitos, formato válido de CNPJ)
- Um CNPJ sendo usado como username indica:
  a. **Bug no frontend** que está passando o CNPJ no campo de username ao invés do e-mail/usuário correto
  b. **Automação/bot** tentando autenticar com identificadores empresariais
  c. **Acesso de sistema integrador** configurado incorretamente
- Se for (a), é um bug que pode bloquear clientes empresariais de acessar o sistema
- Se for (b), é parte do mesmo padrão de credential stuffing de SEC-001

### Recomendações

1. Investigar se existe algum fluxo no frontend que usa CNPJ como campo de login
2. Se for bot, bloquear via rate limiting por padrão de username numérico longo

---

## 🟡 MÉDIO — SEC-006: Usuários com 100% de taxa de GUID vazio (possível automação)

### Dados

4 usuários com zero chamadas legítimas — **todas as suas chamadas têm GUID vazio:**

| user_id | Chamadas com GUID vazio | Chamadas válidas |
|---------|------------------------|-----------------|
| 3073777 | 37 | 0 |
| 3073702 | 34 | 0 |
| 2467704 | 21 | 0 |
| 3090571 | 18 | 0 |

### Análise

- Usuários que nunca fazem uma chamada bem-sucedida têm comportamento anormal
- Pode indicar: scripts de teste sem estado correto, frontend com bug que nunca preenche o GUID para esses usuários, ou clientes usando a API diretamente sem contexto de cotação
- O volume (37 chamadas de um único user em 66 min) é alto para uma falha ocasional

### Recomendações

1. Investigar quem são esses usuários (lookup via `cd_pessoa` no banco `ituranweb`)
2. Verificar se são contas de teste, integradoras ou clientes reais
3. Implementar validação no frontend que impeça a chamada quando `guid_cotacao` for nulo/vazio

---

## 🟡 MÉDIO — SEC-007: Falhas em Cobranças PIX (integração externa)

**Endpoint:** `POST /v3/cobranca/RealizarBaixaPix/{txId}`  

### Dados

- 9 falhas distintas com IDs de transação diferentes
- Erro: `Erro ao buscar informação de cobrança do pix {txId}`
- Serviço: `Ituran.Modulo.Core.Dominio.Modelos.Cobranca`

### Análise

- Falhas no processamento de PIX podem indicar **problemas de integração com o PSP/banco** ou **IDs de transação inválidos sendo testados**
- Os IDs de transação são expostos no caminho da URL (`/RealizarBaixaPix/txId`) — isso é normal para REST, mas os IDs nos logs permitem correlacionar transações financeiras específicas
- 121 eventos do source_context `Ituran.Modulo.Core.Dominio.Modelos.Cobranca` — volume alto

### Recomendações

1. Verificar se há **retry storm**: o sistema está tentando reprocessar os mesmos pagamentos repetidamente?
2. Implementar circuit breaker para a integração com o PSP
3. Garantir que IDs de transação PIX não sejam guessable/sequenciais

---

## 🟡 MÉDIO — SEC-008: Endpoint ERP sem tratamento de erro adequado

**Endpoint:** `POST /erp/invoiceupdate`  
**Volume:** 42 erros

### Dados

- Mensagem: `InvoiceUpdate processing error {invoiceId}`
- IDs de invoice expostos nos logs
- Sem detalhes sobre a causa do erro

### Análise

- Integração com ERP falhando sistematicamente — 42 erros em 66 minutos é alto
- IDs de invoice em texto plano nos logs são dados sensíveis de negócio
- A ausência de detalhes na mensagem de erro dificulta o diagnóstico

---

## 🟡 MÉDIO — SEC-009: Dados PII nos Logs do Seq sem Controle de Acesso

### Dados identificados nos logs

- E-mails de clientes (ex: `contato@taseguroai.com.br`, `elisangelapinentel@gmail.com`)
- Nomes de usuários (ex: `Olinda.Maria`, `rubenilton`)
- IDs numéricos de clientes (`user_id` = `cd_pessoa`)
- IDs de transações PIX
- IDs de cotações (GUIDs)
- Números de invoice ERP

### Análise

- O servidor Seq em `https://seq-prd.ituran.sp` tem **autenticação desabilitada**
- Qualquer pessoa na rede interna da Ituran pode acessar esses dados via browser
- Possível violação da LGPD (Lei 13.709/2018) — dados pessoais de clientes sem controle de acesso adequado
- Os logs ficam retidos por tempo limitado, mas durante o período de retenção estão completamente expostos

### Recomendações

1. **Habilitar autenticação no Seq** imediatamente — configurar usuários e permissões
2. **Mascarar dados PII** nos logs: e-mail → primeiros 3 chars + `***@domínio`, user_id → hash
3. **Revisar política de retenção** de logs com dados pessoais (LGPD art. 15)

---

## 🟢 BAIXO — SEC-010: Usernames em formato não-padrão

### Usuários sem formato de e-mail

`rubenilton`, `Joaobg`, `LucianoThomas`, `Olinda.Maria`, `Ronaldo`, `alexsoriano04`, `fatima1953`, `ivan`, `jadilsonjardim`, `luivilela`, `ottamark`, `versaorap`, `Deico0508`

### Análise

- O sistema aceita usernames que não são e-mail no ClientId `customerAreaApp`
- Usernames simples/curtos são mais suscetíveis a ataques de dicionário
- Formato inconsistente dificulta validação e identificação de usuários

---

## 🟢 BAIXO — SEC-011: EntityFrameworkCore Query Errors

**Volume:** 13 erros  
**Source context:** `Microsoft.EntityFrameworkCore.Query`

### Análise

- Queries EF falhando podem indicar inputs malformados chegando às queries
- Se os inputs não são sanitizados antes de chegarem ao EF, há risco de injeção de dados (mesmo com ORM, LINQ dinâmico pode ser vulnerável)
- Volume baixo, sem padrão claro de ataque

---

## Mapa de Riscos

```
                    IMPACTO
           Baixo    Médio    Alto    Crítico
         ┌────────┬────────┬────────┬────────┐
  Alta   │        │SEC-006 │SEC-001 │        │
         │        │        │SEC-005 │        │
  Média  │        │SEC-007 │SEC-003 │SEC-002 │
         │        │SEC-008 │SEC-004 │        │
  Baixa  │SEC-010 │SEC-009 │        │        │
PROB.    │SEC-011 │        │        │        │
         └────────┴────────┴────────┴────────┘
```

## Prioridade de Ação

| # | Finding | Ação | Prazo |
|---|---------|------|-------|
| 1 | SEC-002 | Investigar e corrigir IdentityServer4 Unhandled exception | Imediato |
| 2 | SEC-001 | Implementar rate limiting em `/v1/Autenticacao/FazerAutenticacao` | 48h |
| 3 | SEC-009 | Habilitar autenticação no Seq | 48h |
| 4 | SEC-003 | Desabilitar Swagger em produção | 1 semana |
| 5 | SEC-004 | Auditar middleware de erro — garantir que stack traces não chegam ao cliente | 1 semana |
| 6 | SEC-005 | Investigar CNPJ como username | 1 semana |
| 7 | SEC-006 | Investigar e bloquear usuários com 100% GUID vazio | 2 semanas |
| 8 | SEC-007 | Implementar circuit breaker PIX | 2 semanas |
| 9 | SEC-008 | Melhorar logging e error handling ERP | 2 semanas |
| 10 | SEC-009 (PII) | Mascarar dados PII nos logs | 1 mês |
