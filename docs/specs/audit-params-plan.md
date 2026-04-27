# Plan — Exposição de JS_PARAMETROS na Auditoria

**Status:** Aguardando decisão de negócio  
**Levantado em:** 2026-04-27  
**Pré-requisito:** Definir quem acessa a página de Auditoria (perfil de acesso/LGPD)

---

## Contexto

A página de Auditoria já identifica **quem** acessou dado desmascarado (badge DADO REAL),
mas não mostra **o quê** foi consultado. O campo `JS_PARAMETROS` dos logs Loki contém
essa informação e foi inspecionado em produção.

---

## Estrutura real do JS_PARAMETROS por serviço

### customer360

Eventos de **consulta** (com `JS_PARAMETROS`):

| Shape | Página | Campos |
|-------|--------|--------|
| Consulta básica | `/basicDataCase` | `CD_PESSOA`, `NR_PLATAFORMA`, `skip`, `take`, `ViewMaskedData` |
| Backlog financeiro | `/FinancialBacklogs` | `CD_PESSOA`, `ViewMaskedData` |
| Faturas | `/ListSettledBills` | `CD_PESSOA` |
| Liberação de dados | `/ReleaseDataVisualization` | `CD_PESSOA`, `SearchType`, `Key` |
| Busca por pessoa | `/SearchPerson` | `type: "Chassis"`, `text: "93Y5SRZ85LJ968821"` ← chassis em claro |
| Perfil plataforma | `/ListProfileByPersonPlatform` | `CD_PESSOA`, `NR_PLATAFORMA`, `ViewMaskedData` |
| Instalações | `/ListInstallations` | `NR_PLATAFORMA` |
| Serviços i360 | `/ListServicesi360` | `CD_PESSOA`, `NR_PLATAFORMA` |
| Agenda | `/ListScheduleItens` | `CD_PESSOA`, `NR_PLATAFORMA`, `CD_USUARIO`, `ViewMaskedData` |

Eventos de **edição** (sem `JS_PARAMETROS`, estrutura diferente):

```json
{
  "DS_TABELA": "PESSOA_TELEFONE",
  "DS_ACAO": "VALIDOU",
  "DS_ALTERACAO": "[DT_ALTERACAO: 27/04/2026 17:36:42]",
  "CD_PESSOA_TELEFONE": 4425197,
  "NM_USUARIO_ALTERACAO": "kathellen.ferreira",
  "DT_ALTERACAO": "2026-04-27T17:36:42.77",
  "CD_PESSOA": 2083455
}
```

### Integra

| Shape | Página | Campos sensíveis |
|-------|--------|-----------------|
| Busca solicitação | `/Solicitacao/ListarDadosPesquisa` | `DS_PLACA: "TJF2J94"`, `DS_CHASSI` |
| Visualizar solicitação | `/Solicitacoes/VisualizarSolicitacao.aspx` | `cdSolicitacao` |
| Busca pessoa | `/Solicitacao/PesquisarPessoa` | **`NR_CNPJ_CPF: "312.145.648-28"`** ← CPF em texto claro |

### fieldservice

| Shape | Página | Campos |
|-------|--------|--------|
| Busca agendamentos | `/BuscaAgendamentos` | `CD_PESSOA_USUARIO`, `dto` (JSON aninhado com `DS_PLACA`, `DS_CHASSI`, `NM_PESSOA_BENEFICIARIO`, datas) |
| Validar acesso | `/ValidarAcesso` | `CD_PESSOA_USUARIO` |
| Check | `/check` | `CD_PESSOA_USUARIO`, `CD_AGENDAMENTO` |

---

## Campos sensíveis identificados (LGPD)

| Campo | Serviço | Sensibilidade |
|-------|---------|---------------|
| `NR_CNPJ_CPF` | Integra | **Alta** — CPF/CNPJ em texto claro |
| `DS_CHASSI` / `Key` (chassis) | Integra, customer360 | Média |
| `DS_PLACA` | Integra, fieldservice | Média |
| `NM_PESSOA_BENEFICIARIO` | fieldservice | Média |
| `CD_PESSOA` | customer360 | Baixa (só ID) |

---

## O que implementar

### Mudanças no backend (`audit.ts`)

Adicionar campo `params` ao `AuditEvent` apenas quando o evento tiver
`ViewMaskedData: true` ou campos sensíveis identificados:

```typescript
interface AuditEvent {
  // ...campos existentes...
  params?: Record<string, unknown>; // JS_PARAMETROS filtrado
}
```

Extrair somente os campos relevantes (não expor campos de paginação como `skip`, `take`):
- `CD_PESSOA`, `NR_PLATAFORMA`, `NR_CNPJ_CPF`, `DS_PLACA`, `DS_CHASSI`
- `SearchType` + `Key` (quando Key parece um chassis/CPF)
- `DS_TABELA`, `DS_ACAO`, `NM_USUARIO_ALTERACAO` (para eventos de edição)

### Mudanças no frontend (`AuditAnalysis.tsx`)

Nas linhas com badge **DADO REAL** nos Eventos Recentes: botão `▶` que expande
uma linha de detalhe mostrando os parâmetros consultados.

Exibição sugerida:
```
▶  [DADO REAL]  kathellen.ferreira  /basicDataCase  10:42:31
   └─ Cliente: #3091700 · Plataforma: 3662172
```

Para `NR_CNPJ_CPF`, exibir mascarado por padrão: `312.***.**8-28`  
com botão de revelar (requer confirmação ou permissão específica).

---

## Decisão pendente

- **Quem acessa a página de Auditoria?** Se for equipe de segurança/compliance,
  pode ver CPF em claro. Se for operação geral, mascarar por padrão.
- **Eventos de edição** (customer360 sem `JS_PARAMETROS`) entram na exibição?
  Atualmente são ignorados pelo extrator — `extractEvent` retorna `null` se
  não há `CD_USUARIO`.
