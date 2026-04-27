# Plano de Simplificação — Sentinela

| Campo | Valor |
|---|---|
| Versão | 1.9 |
| Data da revisão | 2026-04-27 |
| Commit base | `9eb9141` (após pull do `ituran-bra/Sentinela`) |
| Status | Aprovações de Segurança (retenção 7d) e Infra/MSSQL coletadas. Pendente: hostname público + cluster onde aplicar |
| Owner técnico | Miguel Oliveira (`miguelgos` no GitHub) |
| DevOps | Rodolfo Camara |
| Aprovadores | Tech lead, Arquitetura, Segurança (retenção), Infra/SRE (k8s) |
| Como contribuir | Abrir issue ou PR contra este arquivo. Mudanças materiais exigem ack do Owner técnico. |

---

## Sumário executivo

Reduzir o código real do Sentinela de **8.371** para **~6.339 LOC** (corte de **~24%**) em 8 fases independentes, mantendo todas as features de produto. Stack permanece **React + shadcn**; Express é substituído por **TanStack Start** (Fase 4, build via `@tanstack/react-start/plugin/vite` + Nitro); SQLite é removido em favor de cache em memória + cursor opcional; o componente genérico de análise é a maior fonte de redução. Narrativa do Relatório de Ameaças passa de Anthropic API para **Azure OpenAI Foundry interno da Ituran** (`iturin-ai-eastus2-resource`, deployment `sentinela`). Integrações externas atuais: Seq, Datadog, GoCache, ituranweb (MSSQL), **Grafana (Prometheus + Loki)** e Azure OpenAI. Deploy alvo: cluster `cluster-bra-prd`, namespace `integra-prd`. Build e deploy via Azure DevOps; o repo permanece em `github.com/ituran-bra/Sentinela` e é consumido pelo Azure DevOps via GitHub Service Connection.

> **Nota sobre baseline**: a baseline subiu de 6.472 (v1.7) para 8.371 LOC (v1.8) por causa das integrações **Grafana/Prometheus** (Kubernetes, JobScheduler) e **Loki/Auditoria** (commits `d4478ac` e `9eb9141`, +1.899 LOC líquido em 7 arquivos novos no backend e frontend). Saldo absoluto das fases praticamente igual; o corte percentual cai de 29% → 23% porque as features novas não estão no escopo de redução.

---

## Sumário

1. [Estado atual](#1-estado-atual)
2. [Princípios](#2-princípios)
3. [Decisões tomadas](#3-decisões-tomadas)
4. [Decisões pendentes (com aprovadores)](#4-decisões-pendentes-com-aprovadores)
5. [Glossário](#5-glossário)
6. [Stack alvo](#6-stack-alvo)
7. [Fases](#7-fases)
8. [Saldo esperado e Plano B](#8-saldo-esperado-e-plano-b)
9. [Riscos transversais](#9-riscos-transversais)
10. [Matriz RACI](#10-matriz-raci)
11. [Pré-requisitos de ambiente](#11-pré-requisitos-de-ambiente)
12. [Deploy em Kubernetes](#12-deploy-em-kubernetes)
13. [Rollback por fase](#13-rollback-por-fase)
14. [Observabilidade pós-deploy](#14-observabilidade-pós-deploy)
15. [Custos](#15-custos)
16. [Métricas de sucesso](#16-métricas-de-sucesso)
17. [Histórico de revisões](#17-histórico-de-revisões)
18. [Anexo A — Por que React + shadcn](#anexo-a--por-que-react--shadcn)

---

## 1. Estado atual

Medido com `cloc 1.98` em `9eb9141`:

```bash
cloc backend/src --include-ext=ts
# TypeScript  18 files  336 blank  121 comment  2452 code

cloc frontend/src --exclude-dir=ui --include-ext=ts,tsx,css
# TypeScript  21 files  415 blank  52 comment  5853 code
# CSS          1 file     4 blank   0 comment    66 code
```

| Bloco | Code LOC | % do total |
|---|---:|---:|
| Backend (TS) | 2.452 | 29,3% |
| Frontend (TS/TSX, sem `components/ui/`) | 5.853 | 69,9% |
| Frontend (CSS) | 66 | 0,8% |
| **Total código real** | **8.371** | **100,0%** |

`components/ui/` (12 primitivos shadcn em estado padrão) somam 477 LOC e estão **excluídos** da contagem por serem código gerado pelo `shadcn add`. Comentários e brancos também excluídos por padrão do `cloc`.

**Crescimento desde v1.7 (baseline 6.472):**

| Item | LOC | Origem |
|---|---:|---|
| `backend/src/lib/grafanaClient.ts` | 84 | feat `d4478ac` (Grafana/Prometheus) |
| `backend/src/lib/lokiClient.ts` | 66 | feat `9eb9141` (Loki/Audit) |
| `backend/src/routes/grafana.ts` | 204 | feat `d4478ac` |
| `backend/src/routes/audit.ts` | 258 | feat `9eb9141` |
| Cresceu `backend/src/routes/report.ts` | +61 | 3 regras novas (Rule 13, 14, 15) |
| `frontend/src/components/KubernetesAnalysis.tsx` | 415 | feat `d4478ac` |
| `frontend/src/components/JobSchedulerAnalysis.tsx` | 320 | feat `d4478ac` |
| `frontend/src/components/AuditAnalysis.tsx` | 573 | feat `9eb9141` |
| `frontend/src/lib/api.ts` cresceu | +83 | tipos das 3 telas novas |
| **Total novo** | **+2.064** | (+1.899 líquido após cleanup de Gemini residual) |

Top 10 arquivos representam **63% do código real**, o que indica que refactors localizados (especialmente Fase 3) têm alto retorno.

---

## 2. Princípios

1. **Mantém React + shadcn.** Produtividade com IA (Claude/Opus) supera o ganho de LOC de trocar para Svelte/Solid. Justificativa em [Anexo A](#anexo-a--por-que-react--shadcn).
2. **Sem dependência de banco em produção.** Map em memória; cursor file opcional **apenas em dev local**. Validado: nenhuma rota lê além de 7 dias (teto em `routes/events.ts:111`).
3. **Sem perder feature.** Qualquer corte que sacrifique funcionalidade vira decisão pendente em §4 com aprovador explícito.
4. **1 PR por fase, independente.** Cada fase entrega valor isolado e pode ser revertida sem afetar as outras. Fase 4 é a única estrutural; demais são localizadas.
5. **Ordem por ROI.** Fases com maior ganho de LOC por unidade de risco/esforço primeiro.
6. **Atualização de spec acompanha a fase.** RFs invalidados por uma fase são atualizados no mesmo PR daquela fase, não acumulados pra Fase 8.

---

## 3. Decisões tomadas

Validadas em 2026-04-26.

| # | Decisão | Implicação | Aprovado por |
|---|---|---|---|
| 1 | **Manter PDF de qualidade** (jsPDF custom) | Fase 7 = refator de duplicação. Logo SVG rasterizado, header/footer, autotables formatadas permanecem. Saldo: −50 LOC. | Owner técnico |
| 2 | **Sair do Express → TanStack Start** | Fase 4 incluída no plano. Decisão **condicional**: ativa se a janela de validação em staging (§9.2) não evidenciar bloqueador. Plano B em §8.2. | Owner técnico, com pendência operacional em §4.1 |
| 3 | **Charts via shadcn/ui charts** | Fase 6 confirmada. Tremor descartado: `tremorlabs/tremor` sem feature nova desde 2025-04-12 (último push 2025-10-10 foi cleanup); `tremorlabs/tremor-raw` natimorto (2 commits, ambos 2024-12-28). Equipe foi para Vercel/v0. | Owner técnico |
| 4 | **Retenção local reduzida de 90d/7d para 7d único** | Fase 1. Justificativa: nenhuma rota consulta além de 7d (`routes/events.ts:111` tem teto `Math.min(168, …)`). Tier A de 90d era storage não consultado. | Aprovado por Segurança em 2026-04-26 |
| 5 | **1 réplica estritamente em produção** | Polling no Seq + Map em memória não escalam horizontalmente; múltiplas réplicas dobram carga no Seq e divergem o Map entre pods. `replicas: 1`, `maxSurge: 0`, `maxUnavailable: 1`. | Owner técnico, Infra |
| 6 | **Conectividade MSSQL named instance via cluster aprovada** | UDP/1434 + TCP dinâmico até `BRSPO1IDB11.ITURAN.SP\INTEGRA_ESPELHO` permitidos a partir de pods em `integra-prd`. | Aprovado por Infra em 2026-04-26 |
| 7 | **Deploy via Azure DevOps; repo permanece no GitHub** | Build da imagem em `pipeline/app/<categoria>/sentinela.yml` (alinhado com `internalws`, `iturin-web`); manifesto k8s em `pipeline/k8s/cluster-bra-prd/integra-prd/apps/sentinela.yml` (alinhado com `itulink.yml`/`seq.yml`). Sem GitHub Actions. Sem Keel. **Repo continua em `github.com/ituran-bra/Sentinela`**; pipeline Azure DevOps usa GitHub Service Connection (Opção B do §12.4). | Owner técnico, DevOps |
| 8 | **Hostname público: `crm.ituran.sp/sentinela`** | Path-based routing no Ingress agregador. `crm.ituran.sp` já está mapeado no `integra-prd-ingress` (namespace `kong`) — DNS interno já existe, sem dependência de Infra. Implica configurar **basepath `/sentinela`** no Vite (`base: '/sentinela/'`) e no TanStack Router (`basepath: '/sentinela'`). Probes do k8s passam a usar `/sentinela/api/health`. | Owner técnico |
| 9 | **LLM: Azure OpenAI Foundry interno (`iturin-ai-eastus2-resource`)** | Substitui Anthropic API direta. Endpoint `https://iturin-ai-eastus2-resource.openai.azure.com/openai/v1`, deployment `sentinela` (Azure Foundry). SDK `openai` (oficial) com `baseURL` apontando para o endpoint Azure — não usa `@anthropic-ai/sdk`. Vantagens: latência intra-rede Ituran; sem dependência de egress `api.anthropic.com`; modelo gerenciado pela equipe IA. Suporta streaming via `responses.stream()`. | Owner técnico |
| 10 | **Métricas/logs externos via Grafana (`grafana-prd.ituran.sp`)** | Já implementado nos commits `d4478ac` (Prometheus → Kubernetes/JobScheduler) e `9eb9141` (Loki → Auditoria). Auth: `Authorization: Bearer ${GRAFANA_TOKEN}`. Acesso via datasource proxy (`/api/datasources/proxy/uid/<UID>/...`). UIDs hardcoded: `prometheus` (métricas) e `P73FAD9A5042C01FF` (Loki integra-audit). Endpoint **HTTP** (não HTTPS) — interno. 3 novas regras de correlação no Relatório de Ameaças (Rule 13 PROMETHEUS_ALERT, Rule 14 DEPLOYMENT_DOWN, Rule 15 JOBSCHEDULER_ERRORS). Total: 15 regras (era 12). | Implementado pelo Owner técnico |

---

## 4. Decisões pendentes (com aprovadores)

| # | Item | Bloqueia qual fase? | Aprovador | Critério de aprovação |
|---|---|---|---|---|
| 4.1 | TanStack Start em `integra-prd` | Fase 4 | Tech lead, Infra/SRE | Validação em staging por 14 dias. Critério de cancelamento: ≥1 incidente em produção atribuível ao framework (TanStack Start / Nitro) sem workaround in-app, ou regressão > 30% na latência mediana de boot. |
| 4.2 | Conectividade dos endpoints externos a partir do cluster | Deploy em prod | Infra/SRE | Validar com `kubectl run` + curl: `iturin-ai-eastus2-resource.openai.azure.com:443` (Azure OpenAI), `grafana-prd.ituran.sp:80` (Grafana — HTTP interno), `seq-prd.ituran.sp:443` (Seq), `api.us5.datadoghq.com:443` (Datadog), `api.gocache.com.br:443` (GoCache). Recursos internos (Azure OpenAI, Grafana, Seq) com expectativa de zero bloqueio. |
| 4.3 | Deployment `sentinela` criado no Azure Foundry | Fase 2 | Equipe IA | Deployment com nome `sentinela` configurado em `iturin-ai-eastus2` (resource `iturin-ai-eastus2-resource`). Modelo subjacente (gpt-4o-mini, gpt-4o, etc.) decidido pela equipe IA conforme custo/qualidade. |
| 4.4 | Frequência de restart durante a fase de ajuste de dashboards | Fase 1 (impacta UX) | Owner técnico | Se o backend reinicia ≥3x/dia em dev, snapshot JSON local recomendado em §7.1 (já incluído como opcional). |

---

## 5. Glossário

Termos específicos da Ituran, do Sentinela ou do plano.

| Termo | Definição |
|---|---|
| **ACR** | Azure Container Registry da Ituran (`ituran.azurecr.io`). |
| **`integra-dev`** | Namespace Kubernetes do ambiente de desenvolvimento. Análogo `integra-prd` para produção. |
| **`integralake/`** | Repositório de referência da Ituran usado como padrão de deploy (manifestos, Dockerfile, GitHub Actions). |
| **Azure OpenAI Foundry (Ituran)** | Recurso interno `iturin-ai-eastus2-resource` no projeto `iturin-ai-eastus2` (subscription `c36f7b45-…`, RG `IA`, region `eastus2`). Endpoint OpenAI v1: `https://iturin-ai-eastus2-resource.openai.azure.com/openai/v1`. Usado pelo Sentinela na narrativa do Relatório de Ameaças via deployment `sentinela`. |
| **Grafana (Ituran)** | Instância interna em `http://grafana-prd.ituran.sp` (HTTP, sem TLS). Acessada via Bearer token (`GRAFANA_TOKEN`). Usada pelo Sentinela para consultar Prometheus (métricas Kubernetes/JobScheduler) e Loki (logs de auditoria) via datasource proxy. |
| **Loki** | Sistema de logs do Grafana. Datasource UID `P73FAD9A5042C01FF` é o `integra-audit` (logs de auditoria de Integra/customer360/fieldservice, ~140k eventos/24h). Consultado via `/api/datasources/proxy/uid/<UID>/loki/api/v1/query_range`. |
| **Prometheus** | Datasource de métricas do Grafana (UID `prometheus`). Usado pelas rotas `/api/grafana/kubernetes` e `/api/grafana/jobscheduler`. Inclui `ALERTS{alertstate="firing"}` para alertas ativos. |
| **Forcepoint** | Web filter corporativo da Ituran. Bloqueava `generativelanguage.googleapis.com` (motivo da troca histórica Gemini → Claude → Azure OpenAI). Endpoint Azure interno (`*.openai.azure.com`) é recurso da Ituran no Azure — sem expectativa de bloqueio. |
| **Ingress** | Recurso Kubernetes que expõe Services HTTP via hostname e path. Usado pelos apps em `integra-prd` (ex.: `seq-prd.ituran.sp`, `itur.in`). |
| **Keel** | Operador Kubernetes que observa digest de tag e atualiza Deployment. **Não usado neste projeto** — referenciado apenas como contraste com o padrão `integralake`. Sentinela usa deploy controlado via Azure DevOps. |
| **Salesbo** | Sales Backoffice — serviço .NET monitorado pelo Sentinela. |
| **Seq** | Plataforma de logs estruturados em uso pela Ituran (`seq-prd.ituran.sp`). Licença single-user. |
| **`signal-m33301`** | Filtro do Seq usado pelo polling do Sentinela: apenas eventos de erro do `salesbo`. |
| **Snapshot (cursor)** | Arquivo `data/cursor.txt` (ou `data/snapshot.json`) que persiste o `_latestSeqId` e/ou os eventos em memória entre restarts. **Apenas em dev local**. |
| **Tier A/B** | Classificação de retenção atual no SQLite (90d para erros/críticos, 7d para o resto). **Removida em Fase 1** — passa a ser janela única de 7d. |

---

## 6. Stack alvo

| Camada | Hoje | Alvo |
|---|---|---|
| Framework | Express + Vite + React | TanStack Start (mono-repo, server functions) |
| Cliente HTTP front | axios + `lib/api.ts` (256 LOC) | Server functions tipadas (zero camada de espelhamento) |
| UI primitivos | shadcn/ui | shadcn/ui (mantém) |
| Charts | Recharts cru | shadcn/ui charts (Recharts wrapped, oficial) |
| Tabelas | Manual | TanStack Table |
| Estado/cache | `useState` + `useEffect` | TanStack Query |
| Validação/tipos | Manual | Zod (na Fase 4, junto com server functions) |
| LLM | HTTP cru contra `api.anthropic.com` (61 LOC) | `openai` SDK apontado para Azure OpenAI Foundry interno (`iturin-ai-eastus2-resource`, deployment `sentinela`); ~15 LOC com streaming |
| Storage | SQLite (179 LOC) + Map | Map em memória; cursor opcional em dev |
| PDF | jsPDF custom (728 LOC) | jsPDF custom **deduplicado** (header/footer/tabelas em utilitários compartilhados) |
| Polling Seq | Accumulator com write-through | Accumulator simplificado, sem write-through |
| Lookup pessoa | Query por request | Pré-load no boot + refresh diário |
| Cache externos (DD/GC/Grafana) | Sem cache | TTL em memória (30s) |
| Métricas/logs externos | — | Grafana (Prometheus + Loki via datasource proxy, Bearer token) |

---

## 7. Fases

Cada fase é um PR independente. As fases não são pré-requisito umas das outras (exceto onde explicitado), permitindo paralelismo entre devs ou cancelamento isolado.

### Fase 1 — Remover SQLite e ajustar `/api/health`

**Saldo: −157 LOC.** Remove `better-sqlite3` (dependência nativa).

**Justificativa.** Nenhuma rota consulta além de 7d (`routes/events.ts:111`). Tier A de 90d em `db/sqlite.ts:30` é storage não consultado. Catch-up de ~17s no boot é absorvido pelo `readinessProbe` em produção (§12).

**Alterações:**

- Apagar `backend/src/db/sqlite.ts` (152 code LOC após `cloc`).
- Refatorar `backend/src/accumulator.ts`: remover `loadAll`, `bulkInsert`, write-through e `applyRetention`; adicionar TTL drop (janela rolante de 7d) e leitura/escrita de cursor opcional.
- Atualizar `backend/package.json`: remover `better-sqlite3`, `@types/better-sqlite3`.
- Estender `backend/src/index.ts`: endpoint `/api/health` retorna **HTTP 503** quando `isReady() === false`, **200** com `{ ready: true, storeSize, coverage }` quando pronto.
- Atualizar `docs/spec.md` no mesmo PR: remover RF-02, RF-03, RF-04 e a §5.1 (modelo de dados antigo); reescrever §6 (Fluxo de Polling) para refletir o accumulator simplificado.

**Implementação do cursor opcional (apenas em dev):**

```ts
// Habilitado por SNAPSHOT_PATH; ausente em prod (k8s não monta volume)
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH;
function trySaveSnapshot(): void {
  if (!SNAPSHOT_PATH) return;
  try {
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({
      savedAt: new Date().toISOString(),
      latestSeqId: _latestSeqId,
      events: [..._store.values()],
    }));
  } catch (err) {
    console.warn("[accumulator] snapshot falhou:", err);
  }
}
process.on("SIGTERM", () => { trySaveSnapshot(); process.exit(0); });
process.on("SIGINT",  () => { trySaveSnapshot(); process.exit(0); });
```

**Critério de aceite:**

- Backend sobe sem `data/events.db`.
- Após o catch-up, `GET /api/events?limit=1` retorna 200 em < 1s.
- `GET /api/health` retorna **503** durante warming up e **200** com `ready: true` depois.
- Restart em dev com `SNAPSHOT_PATH=./data/snapshot.json`: pronto em < 5s.
- Restart em prod sem snapshot: pronto em < 30s (teto operacional).
- `applyRetention`, `migrate`, `loadAll`, `bulkInsert` deletados.

**Risco:** baixo. Decisão validada em §3.4 / §4.5 (pendência de Segurança).

**Ressalva:** para reduzir 84 GETs em rajada no Seq durante o catch-up, adicionar `await sleep(50)` entre páginas (1 linha; impacto desprezível no tempo total).

---

### Fase 2 — Cortes gratuitos no backend

**Saldo: −135 LOC.** Sem perda de feature.

**Alterações:**

- Inline de `backend/src/lib/ddClient.ts` (35 LOC) em `routes/datadog.ts`.
- Inline de `backend/src/lib/gcClient.ts` (32 LOC) em `routes/gocache.ts`.
- Substituir `backend/src/lib/geminiClient.ts` (58 LOC) por novo `backend/src/lib/aiClient.ts` (~15 LOC) usando o SDK `openai` (oficial) apontado para o endpoint Azure Foundry da Ituran. Renomear o nome do arquivo aproveitando que o conteúdo será reescrito.
- Fundir `backend/src/routes/pessoa.ts` (14 LOC) em `db/mssql.ts`; expor router direto.
- **Consolidar `backend/src/lib/grafanaClient.ts` (84) e `backend/src/lib/lokiClient.ts` (66)** num único `backend/src/lib/grafana.ts` (~80 LOC). As funções `grafanaGet` e `lokiGet` são quase idênticas (mesma URL base `GRAFANA_URL`, mesmo Bearer token, mesmo header; só diferem em timeout). Funde a função HTTP e mantém os 4 helpers (`grafanaPromQuery`, `grafanaPromRange`, `grafanaFiringAlerts`, `lokiQueryRange`).
- Helper único `backend/src/lib/http.ts` com `httpJson(url, headers, body?)` e `httpsJson(url, headers, body?)` (~40 LOC) substitui as funções HTTP quase idênticas em Seq, DD, GC e a base do `grafana.ts`.
- Adicionar env vars para o Azure Foundry (sem hardcoded; tudo vem do `.env`/Secret):
  - `AZURE_OPENAI_ENDPOINT=https://iturin-ai-eastus2-resource.openai.azure.com/openai/v1`
  - `AZURE_OPENAI_API_KEY=<rotacionar antes do primeiro deploy>`
  - `AZURE_OPENAI_DEPLOYMENT=sentinela`

**Snippet de referência do `lib/aiClient.ts` (Fase 2):**

```ts
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AZURE_OPENAI_ENDPOINT!,
  apiKey:  process.env.AZURE_OPENAI_API_KEY!,
});

export async function narrative(prompt: string): Promise<string> {
  const result = await openai.responses.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT ?? "sentinela",
    input: prompt,
  });
  return result.output_text ?? "";
}

// Versão streaming (opcional; usar quando o frontend implementar SSE para o relatório):
export async function narrativeStream(prompt: string, onDelta: (chunk: string) => void): Promise<string> {
  const runner = openai.responses.stream({
    model: process.env.AZURE_OPENAI_DEPLOYMENT ?? "sentinela",
    input: prompt,
  });
  runner.on("response.output_text.delta", (d) => onDelta(d.delta));
  const final = await runner.finalResponse();
  return final.output_text ?? "";
}
```

Removido o detector custom de bloqueio Forcepoint (`PROXY_BLOCKED`): endpoint Azure é interno e o SDK `openai` já lança erros tipados.

**Critério de aceite:**

- `GET /api/datadog/overview` retorna objeto com `monitors`, `logs`, `hosts`, `slos`, `downtimes`, `incidents` em < 3s.
- `GET /api/gocache/overview` retorna objeto com `totals`, `timeline`, `byCountry`, `attackCategories`, `botTypes`, `userAgentTools` em < 3s.
- `GET /api/report/threat` continua produzindo narrativa, agora via `openai` SDK contra o endpoint Azure Foundry. Erros do SDK propagam para o handler como `Error` com `error.code`/`error.status`.
- `GET /api/pessoa/lookup?userIds=...` mantém o contrato.

**Risco:** baixo. Refactor mecânico.

---

### Fase 3 — Componente genérico de análise

**Saldo: −700 a −1.000 LOC** (planejamento usa **−800 LOC** como meta; floor de **−700** se a configuração declarativa não absorver casos especiais).

**Justificativa.** Os 5 componentes "regulares" repetem o mesmo padrão (cards de stat + timeline + top users/IPs + tabela). Total atual: 1.688 code LOC.

**Componentes alvo:**

| Componente | LOC | Cobertura |
|---|---:|---|
| `SecurityAnalysis.tsx` | 515 | Findings hardcoded (14 IDs SEC-XXX); o config precisará suportar render arbitrário por finding |
| `KongAuthAnalysis.tsx` | 369 | Detecção de credential stuffing (regra com janela temporal) |
| `AuthErrorAnalysis.tsx` | 290 | Padrão `<AnalysisPage>` direto |
| `ErrorAnalysis.tsx` | 199 | Padrão `<AnalysisPage>` direto |
| `Dashboard.tsx` | 315 | Parcial (cards + timeline; stats agregados) |
| **Subtotal** | **1.688** | |

Ficam fora (UI específica, não cabem no genérico):
- `DatadogAnalysis.tsx` (834)
- `GoCacheAnalysis.tsx` (481)
- `ReportAnalysis.tsx` (251)
- `LogsTable.tsx` (181)
- `EventDetail.tsx` (78)
- `KubernetesAnalysis.tsx` (415) — gráficos próprios + alertas Prometheus
- `JobSchedulerAnalysis.tsx` (320) — bar chart duplo + tabela providers
- `AuditAnalysis.tsx` (573) — destaques visuais por risco + estatísticas próprias

Total fora: 3.133 LOC. Esses 8 componentes ficam intactos na Fase 3; podem ser ataque de uma fase futura (não prevista no plano atual) se a duplicação se mostrar custosa.

**Spike obrigatório antes do PR principal:** validar que o `AnalysisConfig` cobre `SecurityAnalysis` (caso mais complexo). Se exigir slots de render arbitrário maiores que ~80 LOC por config, reduzir a meta para −700 LOC.

**Forma do `AnalysisConfig`:**

```ts
type AnalysisConfig<T> = {
  title: string;
  subtitle?: string;
  fetcher: () => Promise<T>;
  stats: (data: T) => StatCard[];
  timeline?: (data: T) => TimelineSeries[];
  tables: ((data: T) => TableSpec)[];
  pdfExporter?: (data: T) => void;
  customSections?: ((data: T) => ReactNode)[];   // escape hatch para Security/Kong
};
```

**Critério de aceite:**

- 5 telas renderizam idênticas: validar com **Playwright golden snapshots** (`@playwright/test` + `expect(page).toHaveScreenshot()`).
- Filtros, drill-down (clique em evento → modal `EventDetail`), exportação PDF e contagens preservados.
- **PDFs gerados batem em SHA-256 com baseline** (com `Date` mockado), garantindo que o refactor não afetou exportPdf.
- LOC do diretório `frontend/src/components/` cai em pelo menos 700.

**Risco:** médio. Mitigações:

- Migrar 1 análise por vez (`ErrorAnalysis` primeiro — caso mais simples).
- Manter componente antigo durante a migração; deletar só no último commit.
- Funções `exportXxxPdf` continuam consumindo a estrutura específica de cada análise — `AnalysisData<T>` é genérico e `T` é a estrutura original.

---

### Fase 4 — Migrar para TanStack Start

**Saldo planejado: −230 LOC. Margem real: −230 ± 250 LOC** (risco estrutural alto).

**Pré-requisitos:** Fase 1 mergeada (acumulador rodando sem SQLite). Decisão pendente §4.1 aprovada.

**Antes de começar:** validar via Context7 (`mcp__plugin_context7_context7__query-docs library: tanstack/start`) que a release atual continua usando o plugin Vite + Nitro como builder. Plano alinhado com `integralake/web/vite.config.ts` que usa `@tanstack/react-start/plugin/vite` + `nitro/vite` (Vinxi foi substituído pelo modelo plugin-Vite durante 2025).

**Alterações:**

- Estrutura nova: `app/routes/*.tsx` (file-based router) e `app/routes/api/*.ts` (server functions).
- Cada `backend/src/routes/*.ts` migra para `app/routes/api/*.ts` usando `createServerFileRoute`.
- `backend/src/index.ts` (24 LOC) deletado — TanStack monta o servidor.
- `frontend/src/lib/api.ts` (256 LOC) → ~30 LOC (apenas thin clients onde restar).
- `frontend/vite.config.ts` mesclado com config do server: novo `vite.config.ts` na raiz com plugins `tanstackStart()` + `nitro()` + `viteReact()` + `tailwindcss()` (idêntico ao padrão `integralake/web/vite.config.ts`).
- `accumulator.ts` continua singleton **server-side**: importado uma vez no entry server (não em rotas), garante 1 instância.
- jsPDF e `SentinelaLogo.tsx` permanecem **client-only** (lazy import dinâmico em event handlers para evitar break em SSR).

**Configuração de basepath (obrigatória — hostname `crm.ituran.sp/sentinela`).**

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/sentinela/",
  plugins: [tailwindcss(), tanstackStart(), viteReact(), nitro()],
});
```

`app/router.tsx` (ou onde o `createRouter` é chamado):

```ts
export function createRouter() {
  return createTanStackRouter({
    routeTree,
    basepath: "/sentinela",
  });
}
```

**Endpoint de health (sintaxe correta TanStack Start):**

```ts
// app/routes/api/health.ts → expõe /sentinela/api/health
import { createServerFileRoute } from "@tanstack/react-start/server";
import { isReady, storeSize, storeCoverage } from "~/server/accumulator";

export const ServerRoute = createServerFileRoute().methods({
  GET: async () => {
    if (!isReady()) {
      return Response.json({ status: "warming up", ready: false }, { status: 503 });
    }
    return Response.json({
      status: "ok",
      ready: true,
      storeSize: storeSize(),
      coverage: storeCoverage(),
      timestamp: new Date().toISOString(),
    });
  },
});
```

**Validar antes de copiar:** a API `createServerFileRoute` está estável na release atual; conferir via Context7. Confirmar também que `basepath` do `createRouter` se propaga para as server functions (caso contrário, ajustar manualmente).

**Dependências adicionadas:**

- `@tanstack/react-start` (já traz `plugin/vite` e o runtime de server functions)
- `@tanstack/react-router`
- `nitro` (build de produção; também trazido pelo TanStack Start em algumas releases — verificar duplicidade)
- `zod` (validação de payloads de server functions)

**Dependências removidas:**

- `express`, `@types/express`
- `cors`, `@types/cors`
- `axios`

**Riscos específicos:**

- **Singleton do accumulator** em runtime serverless: se a release do TanStack Start subir handlers em workers isolados, o singleton instancia N vezes. Validar em staging.
- **jsPDF em SSR:** `frontend/src/lib/exportPdf.ts` carrega o logo SVG no module load (`createCanvas` etc.). Forçar lazy import: `const { exportXxxPdf } = await import("~/lib/exportPdf")` dentro do click handler.
- **Maturidade do Nitro:** ecossistema ainda em consolidação. Existência do Plano B ([§8.2](#82-plano-b-cancelamento-da-fase-4)) é parte essencial desta fase.

**Critério de aceite:**

- Todas as 9 rotas REST funcionam idênticas (curl/Postman antes/depois).
- Boot inicia o accumulator **uma única vez** (asserção em log: `[accumulator] iniciado` aparece 1× por boot).
- `frontend/src/lib/api.ts` ≤ 30 LOC.
- `npm run build` produz `.output/server/index.mjs`.
- Build single-step: `npm run build` na raiz substitui o build duplo backend+frontend.

**Risco:** alto. Reposicionada como **melhoria estrutural** (mono-repo, type-safety end-to-end, fim do espelhamento de tipos), não como redução de LOC — o saldo de −230 é secundário ao ganho arquitetural.

---

### Fase 5 — TanStack Query + TanStack Table

**Saldo: −200 LOC.**

**Alterações:**

- Substituir `useState`/`useEffect` para fetch por `useQuery` em todos os componentes.
- `LogsTable.tsx` (181 LOC) refatorada com TanStack Table (filtro/sort/paginação).
- Caches automáticos (TanStack Query) eliminam refetch redundante na navegação.

**Critério de aceite:**

- Todas as queries usam um padrão `<QueryBoundary>` definido em `components/QueryBoundary.tsx` (Skeleton durante loading, alerta em erro).
- Tabela de logs mantém UX (filtro multi-campo, sort, paginação, drill-down).
- Refetch em background a cada N segundos onde fizer sentido (configurável).

**Risco:** médio. Substituição mecânica + ajustes finos de invalidação de cache.

---

### Fase 6 — Charts via shadcn/ui charts

**Saldo: −300 LOC.**

**Tremor descartado** — verificado em 2026-04-26 via `gh`:

```
tremorlabs/tremor       último push 2025-10-10 (cleanup); última feature 2025-04-12 (revertida)
tremorlabs/tremor-raw   2 commits totais em 2024-12-28 (natimorto)
```

**Alterações:**

- Configurações de Recharts em `Dashboard`, `ErrorAnalysis`, `AuthErrorAnalysis`, `KongAuthAnalysis`, `Datadog`, `GoCache` simplificadas.
- Uso de `<ChartContainer>` + `<ChartConfig>` do shadcn/ui charts.

**Critério de aceite:**

- Todos os charts mantêm: tooltip, legenda, eixos, cores do tema, responsividade.
- Comparação visual via Playwright snapshots (mesmo conjunto da Fase 3).

**Risco:** baixo.

---

### Fase 7 — Refator do PDF custom (Opção A confirmada)

**Saldo: −50 LOC.** Mantém qualidade do PDF.

**Alterações em `frontend/src/lib/exportPdf.ts` (728 code LOC):**

- Extrair `pdfHeader(doc, { title, subtitle })` — barra azul + logo + textos.
- Extrair `pdfFooter(doc)` — paginação no rodapé.
- Extrair `pdfTable(doc, { columns, rows, startY })` — wrapper de autotable com estilo padrão.
- Cada `exportXxxPdf` reduz ao essencial: cabeçalho, chamada das tabelas/seções específicas, footer.

**Critério de aceite:**

- Os 6 PDFs (Dashboard, GUID Cotação vazio, Falhas Auth, Kong Auth, Segurança, Relatório de Ameaças) renderizam **idênticos** ao baseline.
- **Comparação byte-a-byte** com `Date` mockado: SHA-256 dos PDFs gerados igual aos baselines em `tests/fixtures/pdf-baselines/`.
- `exportPdf.ts` reduzido em ≥ 50 LOC.

**Risco:** baixo.

---

### Fase 8 — Cleanup técnico

**Saldo: −60 LOC** + remoção de inconsistências documentais residuais.

**Alterações:**

1. Remover `docker-compose.yml` (raiz) — já marcado como legado em README; aponta para `schema.sql` deletado.
2. Remover linha `DATABASE_URL=postgresql://...` de `backend/.env.example`.
3. Mover credenciais MSSQL hardcoded em `backend/src/db/mssql.ts:6-7` para `.env` (`MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_SERVER`, `MSSQL_DATABASE`, `MSSQL_INSTANCE`).
4. Restringir `rejectUnauthorized: false` ao Seq apenas (cert autoassinado). Em prod fora do WSL, Datadog, GoCache e Azure OpenAI devem usar verificação TLS normal — usar flag por host (`SEQ_INSECURE_TLS=true` apenas).
5. Marcar `ADR-006` como `Status: Superseded by ADR-010`. Marcar `ADR-011` (relatorio-ameacas-gemini) com nota explicando a evolução Gemini → Claude → Azure OpenAI Foundry.
6. Substituir referências históricas a "Gemini" e "Anthropic" por "Azure OpenAI Foundry" em README e spec.md residuais. Renomear `geminiClient.ts` → `lib/aiClient.ts` (já foi quase tudo na Fase 2; este passo finaliza imports/docs).
7. Remover `@types/jspdf` do `frontend/package.json` (descontinuado; jsPDF v4+ traz tipos).
8. Atualizar `docs/spec.md` para remover qualquer menção residual a Tier A/B.

**Critério de aceite:**

- `docker-compose.yml` deletado.
- `mssql.ts` lê do `.env`.
- README/spec coerentes com Azure OpenAI Foundry.
- ADRs com status `Superseded` corretos.
- `grep -ri "gemini\|tier a\|sqlite\|postgres" docs/ README.md` retorna apenas referências históricas em ADR.

**Risco:** baixo (mecânico).

---

### Fase 9 — Reorganização da documentação

**Saldo: 0 LOC de código.** Não toca código-fonte; reorganiza somente arquivos em `docs/` e atualiza links cruzados.

**Justificativa.** O `spec.md` cresceu para 430 linhas misturando visão, requisitos funcionais (15), requisitos não-funcionais, modelo de dados, fluxos, extração regex, telas (12) e integrações (6). Quem entra hoje no projeto não tem entrada natural por tela ou por integração — precisa ler o arquivo inteiro. Os ADRs estão em `docs/adr/` desconectados de uma estrutura mais ampla de "arquitetura".

**Estrutura proposta:**

```
docs/
├── architecture/
│   ├── README.md                     # overview de alto nível, diagrama da stack, links cruzados
│   ├── adr/                          # ← ADRs movidos de docs/adr/ (mantém ADR-001..014)
│   │   ├── ADR-001-banco-postgresql.md
│   │   ├── …
│   │   └── ADR-014-pdf-logo-canvas.md
│   ├── data-model.md                 # ← do spec.md §5 (modelo de dados, schema SQLite ou Map)
│   ├── polling-flow.md               # ← do spec.md §6 (fluxo accumulator + cursor)
│   └── extraction.md                 # ← do spec.md §7 (regex + JSON parsing Kong)
├── specs/
│   ├── README.md                     # índice + RF-XX → arquivo
│   ├── overview.md                   # ← do spec.md §1 (Visão Geral) + NRFs §4
│   ├── pages/
│   │   ├── README.md                 # tabela das 12 telas (substitui spec.md §8)
│   │   ├── error-analysis.md         # RF-07 + spec.md §2.1 (GUID Cotação vazio)
│   │   ├── auth-errors.md            # RF-08 + §2.2 (Falhas de Autenticação)
│   │   ├── kong-auth.md              # RF-09 + §2.3
│   │   ├── security.md               # RF-10 + §2.4 (14 findings SEC-XXX)
│   │   ├── datadog.md                # RF-13 + §2.5 (monitores, infra, IIS, SQL)
│   │   ├── gocache.md                # RF-14 + §2.6 (WAF, bots, geo)
│   │   ├── kubernetes.md             # NOVO (Grafana/Prometheus, alertas firing)
│   │   ├── jobscheduler.md           # NOVO (Grafana/Prometheus, providers)
│   │   ├── audit.md                  # NOVO (Grafana/Loki, integra-audit DS)
│   │   └── threat-report.md          # RF-15 + §2.7 (15 regras de correlação)
│   └── integrations/
│       ├── README.md                 # contrato resumido por integração
│       ├── seq.md                    # API REST do Seq, signals, paginação afterId
│       ├── datadog.md                # ← do spec.md §9.1 (endpoints DD, métricas IIS/SQL)
│       ├── gocache.md                # ← do spec.md §9.2
│       ├── grafana.md                # NOVO (Prometheus + Loki via datasource proxy)
│       ├── azure-openai.md           # ← do spec.md §9.3 (atualizado para Azure Foundry)
│       └── ituranweb.md              # MSSQL pessoa lookup
├── refactor-plan.md                  # mantém (este arquivo)
├── security-analysis.md              # mantém (análise pontual, não é spec)
├── logo.svg
└── logo-icon.svg
```

**Mapeamento detalhado `spec.md` → novos arquivos:**

| Seção atual em `spec.md` | Vai para |
|---|---|
| §1 Visão Geral | `specs/overview.md` |
| §2.1 GUID Cotação vazio | `specs/pages/error-analysis.md` |
| §2.2 Falhas de auth | `specs/pages/auth-errors.md` |
| §2.3 Kong Auth | `specs/pages/kong-auth.md` |
| §2.4 Findings de segurança (14 SEC-XXX) | `specs/pages/security.md` |
| §2.5 Datadog | `specs/pages/datadog.md` |
| §2.6 GoCache WAF | `specs/pages/gocache.md` |
| §2.7 Relatório de Ameaças (12 regras + 3 novas = 15) | `specs/pages/threat-report.md` |
| §3 RF-01 a RF-15 | distribuídos por `specs/pages/*.md` (cada RF junto da tela correspondente) |
| §4 NRFs | `specs/overview.md` |
| §5 Modelo de dados | `architecture/data-model.md` |
| §6 Fluxo de Polling | `architecture/polling-flow.md` |
| §7 Extração de campos (regex + JSON) | `architecture/extraction.md` |
| §8 Tabela de telas | `specs/pages/README.md` (índice) |
| §9.1 Datadog endpoints | `specs/integrations/datadog.md` |
| §9.2 GoCache endpoints | `specs/integrations/gocache.md` |
| §9.3 Anthropic API | `specs/integrations/azure-openai.md` (renomear + atualizar) |

**Novos arquivos sem origem no `spec.md`** (porque ainda não estão documentados):

- `specs/pages/kubernetes.md`
- `specs/pages/jobscheduler.md`
- `specs/pages/audit.md`
- `specs/integrations/seq.md`
- `specs/integrations/grafana.md`
- `specs/integrations/ituranweb.md`

**O que sobra no `spec.md` original.**

Após o split, deletar `docs/spec.md`. Em seu lugar, criar `docs/specs/README.md` apontando para os arquivos individuais. Quem clica em links antigos (commits, READMEs externos) cai num 404 — mitigar adicionando uma redireção via uma tag HTML no `README.md` da raiz que mencione "spec.md foi quebrado em `docs/specs/`".

**Atualizações associadas:**

- `README.md` da raiz: trocar links de `docs/spec.md` para `docs/specs/`.
- `docs/refactor-plan.md` (este arquivo): atualizar referências a `docs/adr/...` para `docs/architecture/adr/...`.
- ADR-007 (`docs/adr/ADR-007-stack-frontend.md`): nada muda.
- Hooks de CI/lint que validem links quebrados (se houver) precisam re-rodar.

**Critério de aceite:**

- Estrutura `docs/architecture/` e `docs/specs/` criada conforme acima.
- `docs/spec.md` substituído por `docs/specs/README.md` com índice.
- `docs/adr/` movido para `docs/architecture/adr/`.
- Cada arquivo individual tem ≤ 100 linhas (regra de bolso para legibilidade).
- `grep -r "docs/adr/\|docs/spec\.md" .` retorna 0 ocorrências (todos os links atualizados).
- README da raiz aponta para a nova estrutura.
- 3 telas novas (Kubernetes, JobScheduler, Audit) ganham documentação dedicada.
- 3 integrações sem doc hoje (Seq, Grafana, ituranweb) ganham documentação dedicada.

**Risco:** baixo. É renomeação + split + atualização de links.

**Pode ser feita em paralelo com qualquer outra fase**, exceto Fase 8 (cleanup técnico inclui atualizar `spec.md` para remover Tier A/B) — coordenar para evitar conflito de merge: Fase 9 deve **vir depois** ou **englobar** o que a Fase 8 prescreve sobre docs.

---

## 8. Saldo esperado e Plano B

### 8.1 Saldo total

| Fase | LOC | Acumulado | Confiança |
|---|---:|---:|---|
| Hoje (`9eb9141`) | — | 8.371 | medido |
| 1. Remover SQLite | −157 | 8.214 | alta |
| 2. Cortes gratuitos backend (incluindo consolidação grafana+loki) | −135 | 8.079 | alta |
| 3. Componente genérico (5 análises regulares; 3 telas novas ficam fora) | −800 (range −700 a −1.000) | 7.279 | média |
| 4. TanStack Start | −230 (range −500 a 0) | 7.049 | baixa |
| 5. TanStack Query + Table (cobre todas as 12 telas) | −250 | 6.799 | média |
| 6. shadcn/ui charts (cobre Datadog/GoCache/Kubernetes/JobScheduler) | −350 | 6.449 | alta |
| 7. Refator PDF | −50 | 6.399 | alta |
| 8. Cleanup técnico | −60 | **6.339** | alta |
| 9. Reorganização de docs | 0 | 6.339 | n/a (não toca código) |

**Meta consolidada: ~6.300–6.500 LOC (corte de 22%–25%).** Fase 9 não altera LOC de código (é só `docs/`), mas entra no plano por gerar artefato consultável que reduz fricção de onboarding. O range otimista da Fase 4 está limitado a 0 LOC (sem regressão); um saldo positivo seria sinal pra acionar o Plano B em §8.2.

> **Por que a meta % caiu de 29% (v1.7) para 23% (v1.8).** A baseline cresceu +1.899 LOC (Grafana, Loki, Audit) sem que esses arquivos entrassem no escopo de redução. As 3 telas novas (`KubernetesAnalysis`, `JobSchedulerAnalysis`, `AuditAnalysis`, totalizando 1.308 LOC) têm UI específica e ficam intactas. As Fases 5 (TanStack Query) e 6 (shadcn charts) tiveram o saldo aumentado em +50 cada porque agora cobrem mais componentes. Saldo absoluto subiu de 1.882 para 1.982 LOC.

> **Nota sobre double-counting Fase 4 + Fase 5.** Ambas reduzem `lib/api.ts` (256 LOC). Fase 4 reduz para ~30 LOC (substitui axios por server functions). Fase 5 não toca `lib/api.ts` adicionalmente — atua sobre `useState`/`useEffect` nos componentes. Se a Fase 4 for cancelada (Plano B), a Fase 5 ainda entrega seus −200 LOC mexendo em componentes de tela.

### 8.2 Plano B (cancelamento da Fase 4)

Se a janela de validação de 14 dias em staging evidenciar bloqueador de TanStack Start (item §4.1), a Fase 4 é **substituída por uma Fase 4'**:

- **Fase 4' (Plano B):** introduzir `tRPC` (ou `ts-rest`) sobre Express. Saldo estimado: **−150 a −200 LOC** (matando a maior parte de `lib/api.ts`).
- Demais fases (1, 2, 3, 5, 6, 7, 8) **independem** de Fase 4 e seguem.
- Saldo total no Plano B: **8.371 → ~6.569 LOC (corte de ~22%)**.

A decisão de adotar o Plano B é do Tech lead após o período de validação. Critério objetivo: ≥1 incidente de runtime atribuível ao TanStack Start ou Nitro, sem workaround in-app, durante a janela de staging.

---

## 9. Riscos transversais

| # | Risco | Severidade | Mitigação |
|---|---|---|---|
| 9.1 | Refactor frontend (Fase 3) introduz regressão visual | alta | Playwright golden snapshots + comparação byte-a-byte de PDF; migração 1 análise por vez; deletar componente antigo só no último commit |
| 9.2 | TanStack Start instável em produção | alta | Janela de 14d em staging; Plano B explícito; verificar maturidade da release atual via Context7 antes da migração |
| 9.3 | Catch-up de 7d no boot dispara rate-limit do Seq ou estoura licença single-user | alta | `await sleep(50)` entre páginas; validar com o time que opera o Seq antes do primeiro deploy; usar API key dedicada se possível |
| 9.4 | `readOnlyRootFilesystem: true` quebra cursor file em prod | média | Cursor é **apenas em dev** (`SNAPSHOT_PATH` ausente em prod). Em prod, sempre catch-up. Documentado em §7.1. Para dev rodando em container (não em host), exportar `SNAPSHOT_PATH=/tmp/snapshot.json` ou montar volume gravável. |
| 9.5 | Single-replica + maxSurge=1 dispara polling duplo no Seq durante rollout | alta | Configurar `maxSurge: 0, maxUnavailable: 1` (aceita downtime de poucos segundos no rollout em troca de zero polling duplo) |
| 9.6 | Egress até `iturin-ai-eastus2-resource.openai.azure.com` indisponível ou throttled | média | Decisão pendente §4.2 — validar conectividade antes do deploy. Como é recurso interno da Ituran no Azure, expectativa é zero bloqueio. Se houver throttling, o SDK retorna 429 e a UI mostra fallback estático. |
| 9.7 | jsPDF carrega no SSR e quebra build da Fase 4 | alta | Lazy import dinâmico (`(await import("...")).default`) dentro de event handlers; **proibir** import top-level em rotas |
| 9.8 | nginx-ingress não mergeia `/sentinela` com `/` do Kong em `crm.ituran.sp` | média | Validar em ambiente de teste antes do primeiro deploy: `kubectl describe ingress -n integra-prd sentinela-ingress` deve aparecer junto do `integra-prd-ingress`. Se nginx-ingress estiver com `--ingress-class=nginx` e ambos usarem essa classe, merge é automático. Caso contrário, fallback é editar o `0-namespace.yml` do `kong` adicionando o path. |
| 9.9 | Snapshot JSON em dev cresce sem limite | baixa | TTL de 7d na janela rolante já controla; arquivo é sobrescrito em cada SIGTERM |
| 9.10 | Equipe IA renomeia ou desativa o deployment `sentinela` no Azure Foundry | média | Env var `AZURE_OPENAI_DEPLOYMENT` permite troca sem rebuild; alinhar com a equipe IA quem é o ponto de contato para mudanças nesse deployment; observabilidade do app deve logar erro 404 do SDK separadamente para detectar deployment ausente. |
| 9.11 | Deploy via Azure DevOps falha silenciosamente | média | Configurar notificação de falha do pipeline `cluster-bra-prd` para o Owner técnico; logar restarts e crash loops no Datadog |
| 9.12 | Grafana indisponível ou Loki query timeout | baixa | `lokiClient.ts`/`grafanaClient.ts` já tratam falha retornando `null`/array vazio (nunca lançam). Telas Kubernetes/JobScheduler/Audit mostram dado parcial em vez de quebrar. UID do datasource `P73FAD9A5042C01FF` está hardcoded em `lokiClient.ts:3` — se o datasource for recriado no Grafana, precisa atualizar o constante (a Fase 8 pode mover para env var). |

---

## 10. Matriz RACI

R = Responsável (executa); A = Aprovador; C = Consultado; I = Informado.

Nomes preenchidos em 2026-04-26.

| Fase / atividade | Miguel Oliveira (Owner) | Rodolfo Camara (DevOps) | Tech lead | Arquitetura | Segurança | Infra/SRE | Produto |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Fase 1 (SQLite) | R | C | A | C | I | I | I |
| Fase 2 (cortes gratuitos) | R | I | A | I | – | – | – |
| Fase 3 (componente genérico) | R | I | A | C | – | – | C |
| Fase 4 (TanStack Start) | R | C | A | A | C | C | I |
| Fase 5 (Query/Table) | R | I | A | I | – | – | – |
| Fase 6 (shadcn charts) | R | I | A | I | – | – | C |
| Fase 7 (PDF) | R | I | A | I | – | – | C |
| Fase 8 (cleanup) | R | C | A | – | C | – | – |
| Fase 9 (reorganização docs) | R | I | A | C | – | – | I |
| Aprovação retenção 7d | I | I | C | – | A ✓ | I | – |
| Aprovação MSSQL egress | I | C | C | – | C | A ✓ | – |
| Aprovação Azure OpenAI egress + deployment `sentinela` | I | C | C | – | C | A | C (Equipe IA) |
| Definição de hostname público | C | R | C | – | – | A | – |
| Manifesto em `pipeline/` (sentinela.yml) | C | R | A | – | – | C | – |
| Deploy em prod (rollout) | C | R | A | C | C | C | I |
| Rollback em prod | C | R | A | – | – | C | I |

✓ = aprovação coletada em 2026-04-26.

---

## 11. Pré-requisitos de ambiente

Validar **antes** do primeiro deploy:

**Cluster e namespace**

- [x] Namespace `integra-prd` existe (vide `pipeline/k8s/cluster-bra-prd/integra-prd/0-namespace.yml`).
- [x] Secret `azure-container-registry` em `integra-prd` (padrão já usado por `itulink`, `seq`, etc.).
- [ ] Secret `sentinela-secrets` aplicado conforme §12.2.
- [x] **Hostname público definido**: `crm.ituran.sp/sentinela` (Decisão #8). DNS interno já mapeado em `integra-prd-ingress`.
- [ ] **Basepath `/sentinela` configurado na app** (Vite + TanStack Router) — verificar na Fase 4.
- [ ] Egress do cluster permite saída para:
  - [ ] `seq-prd.ituran.sp:443`
  - [ ] `iturin-ai-eastus2-resource.openai.azure.com:443`
  - [ ] `api.us5.datadoghq.com:443`
  - [ ] `api.gocache.com.br:443`
  - [ ] `grafana-prd.ituran.sp:80` (HTTP interno; Prometheus + Loki via datasource proxy)
- [x] Conectividade TCP+UDP até `BRSPO1IDB11.ITURAN.SP\INTEGRA_ESPELHO` (Decisão #6).
- [ ] Deployment `sentinela` configurado no Azure Foundry (`iturin-ai-eastus2`) — confirmar com equipe IA.
- [ ] API key do Azure OpenAI rotacionada após exposição em chat (gerar nova no portal e revogar a anterior).
- [ ] **`GRAFANA_TOKEN`** (Bearer) provisionado no Grafana interno e armazenado no Secret `sentinela-secrets`. Permissões mínimas: leitura nos datasources `prometheus` e `P73FAD9A5042C01FF` (Loki integra-audit).

**GitHub (origem do código)**

- [ ] **Transferência de ownership** do repo de `Miguelgos/Sentinela` para a org `ituran-bra` concluída (Settings → Transfer ownership). URL final: `github.com/ituran-bra/Sentinela`.
- [ ] Membros da org `ituran-bra` com permissão de push (Owner técnico = Miguel Oliveira; DevOps = Rodolfo Camara).
- [ ] Branch protection mantida em `master` (mesma config que tinha em `Miguelgos/Sentinela`, se houver).

**Azure DevOps (build pipeline) — Opção B (GitHub)**

- [ ] GitHub Service Connection (`github-ituran-bra-sentinela`) criada no projeto TI, autorizada para `ituran-bra/Sentinela`. **Criar somente após a transferência** — caso contrário, configure uma SC temporária para `Miguelgos/Sentinela` e atualize o `endpoint` no pipeline pós-transfer.
- [x] Service connection `ituran-acr` no projeto TI (já existe).
- [x] Variable group `INTEGRA` (já existe).
- [x] Pool `linux-agent-bra` (já existe).
- [ ] Permissão de push do build agent do Sentinela no repo `TI/pipeline` (Project Settings → Repos → pipeline → Security: adicionar build identity como Contributor).
- [ ] No pipeline `sentinela`: autorizar uso dos recursos `ituran-bra/Sentinela` (GitHub) e `TI/pipeline` (Azure DevOps) — Pipelines → Edit → Resources.
- [ ] Pipeline Azure DevOps `cluster-bra-prd` (em `pipeline/`) já cobre `k8s/cluster-bra-prd/*` — sim (vide `cluster-bra-prd.yml`).

---

## 12. Deploy em Kubernetes

Fluxo de deploy:

1. **Build da imagem** — pipeline Azure DevOps em `pipeline/app/integra/sentinela.yml` (este documento §12.4) constrói a imagem e dá push como `ituran.azurecr.io/integra/sentinela:1.0.<BuildId>` no ACR. Stage seguinte do mesmo pipeline atualiza a tag em `pipeline/k8s/.../apps/sentinela.yml` e comita no repo `TI/pipeline`.
2. **Deploy do manifesto** — pipeline `pipeline/k8s/cluster-bra-prd.yml` detecta a mudança em `k8s/cluster-bra-prd/*` e aplica via `kubectl apply` (`_pipeline.sh`). Padrão idêntico a `itulink.yml` / `seq.yml`.
3. **Sem GitHub Actions, sem Keel.** Cada commit em `master` do repo `github.com/ituran-bra/Sentinela` = build → bump da tag → deploy automático em prd (via Azure DevOps).

### 12.0 Hostname público — `crm.ituran.sp/sentinela` (decisão tomada §3 #8)

`crm.ituran.sp` **já existe** como host do `integra-prd-ingress` (namespace `kong`), atualmente apontando para `api-gateway-kong-proxy:80` em `path: /`. DNS interno já está mapeado para o cluster.

#### Como `/sentinela` se sobrepõe ao `/` existente

`nginx-ingress` faz **longest-prefix match** entre regras de hosts iguais provenientes de Ingresses diferentes. Adicionar um Ingress separado em `integra-prd` com:

```
host: crm.ituran.sp
path: /sentinela    pathType: Prefix
```

faz o controller mergear com o Ingress agregador do `kong` automaticamente. `/sentinela/*` vai para o service Sentinela; resto continua indo para o Kong.

Não é necessário editar o `0-namespace.yml` do `kong`.

#### Implicação na app — basepath obrigatório

Como o Ingress **não** faz rewrite (preferência por simplicidade e zero ambiguidade), a app precisa servir em `/sentinela/*` no servidor e o cliente precisa pedir assets a partir de `/sentinela/`:

| Camada | Configuração |
|---|---|
| Vite (`vite.config.ts`) | `base: '/sentinela/'` |
| TanStack Router (`createRouter`) | `basepath: '/sentinela'` |
| TanStack Start server functions | Respondem em `/sentinela/api/*` automaticamente quando o `basepath` está propagado pelo `Router`. Confirmar no código gerado pelo `vite build`. |
| `index.html` | Vite injeta `<base href="/sentinela/">` automaticamente quando `base` é definido. Não precisa editar manual. |
| Probes do k8s (`/api/health`) | Passam a apontar para `/sentinela/api/health` (porque a app só responde com basepath). |
| jsPDF / outros assets carregados em runtime | `import.meta.env.BASE_URL` retorna `/sentinela/` — usar isso em vez de hardcode. |

**Por que não usar rewrite no Ingress (alternativa rejeitada).** A annotation `nginx.ingress.kubernetes.io/rewrite-target: /$2` mantém a app pensando que está em `/`, mas links absolutos no HTML quebram (browser tenta `crm.ituran.sp/assets/main.css` em vez de `crm.ituran.sp/sentinela/assets/main.css`). Solução requer `<base href="/sentinela/">` injetado manualmente — frágil e mais difícil de debugar. O custo de configurar `base` no Vite é uma linha; a benefício é app robusta a mudanças futuras.

#### Cuidado em desenvolvimento local

Em dev (`npm run dev`), o servidor Vite continua respondendo na raiz `localhost:5173/sentinela/`. O `npm run dev` **com** `base: '/sentinela/'` configurado serve corretamente em `http://localhost:5173/sentinela/`. Tentar acessar `http://localhost:5173/` retorna 404. Documentar no README pós-Fase 4.

### 12.1 Manifesto único — `pipeline/k8s/cluster-bra-prd/integra-prd/apps/sentinela.yml`

Padrão Ituran: ConfigMap + Secret + Deployment + Service + Ingress num arquivo só. Sem Keel. Tag fixa atualizada por commit no repo `pipeline`.

```yaml
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: sentinela-config
  namespace: integra-prd
data:
  PORT: "3000"
  SEQ_URL: "https://seq-prd.ituran.sp"
  SEQ_SIGNAL: "signal-m33301"
  SEQ_INSECURE_TLS: "true"
  DD_SITE: "us5.datadoghq.com"
  MSSQL_SERVER: "BRSPO1IDB11.ITURAN.SP"
  MSSQL_DATABASE: "ituranweb"
  MSSQL_INSTANCE: "INTEGRA_ESPELHO"
  AZURE_OPENAI_ENDPOINT: "https://iturin-ai-eastus2-resource.openai.azure.com/openai/v1"
  AZURE_OPENAI_DEPLOYMENT: "sentinela"
  GRAFANA_URL: "http://grafana-prd.ituran.sp"
  NODE_ENV: "production"

---
apiVersion: v1
kind: Secret
metadata:
  name: sentinela-secrets
  namespace: integra-prd
type: Opaque
stringData:
  azure-openai-api-key: "REPLACE_ME"
  grafana-token:        "REPLACE_ME"
  dd-api-key:        "REPLACE_ME"
  dd-app-key:        "REPLACE_ME"
  gc-token:          "REPLACE_ME"
  mssql-user:        "REPLACE_ME"
  mssql-password:    "REPLACE_ME"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sentinela
  namespace: integra-prd
  labels:
    app: sentinela
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  selector:
    matchLabels:
      app: sentinela
  template:
    metadata:
      labels:
        app: sentinela
    spec:
      imagePullSecrets:
        - name: azure-container-registry
      containers:
        - name: sentinela
          image: ituran.azurecr.io/integra/sentinela:v0.1.0
          envFrom:
            - configMapRef:
                name: sentinela-config
          env:
            - name: AZURE_OPENAI_API_KEY
              valueFrom: { secretKeyRef: { name: sentinela-secrets, key: azure-openai-api-key } }
            - name: GRAFANA_TOKEN
              valueFrom: { secretKeyRef: { name: sentinela-secrets, key: grafana-token } }
            - name: DD_API_KEY
              valueFrom: { secretKeyRef: { name: sentinela-secrets, key: dd-api-key } }
            - name: DD_APP_KEY
              valueFrom: { secretKeyRef: { name: sentinela-secrets, key: dd-app-key } }
            - name: GC_TOKEN
              valueFrom: { secretKeyRef: { name: sentinela-secrets, key: gc-token } }
            - name: MSSQL_USER
              valueFrom: { secretKeyRef: { name: sentinela-secrets, key: mssql-user } }
            - name: MSSQL_PASSWORD
              valueFrom: { secretKeyRef: { name: sentinela-secrets, key: mssql-password } }
          ports:
            - containerPort: 3000
              protocol: TCP
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "768Mi"
              cpu: "1"
          # Path com basepath; tolera o catch-up inicial do accumulator (~17s típico)
          startupProbe:
            httpGet: { path: /sentinela/api/health, port: 3000 }
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 30
          readinessProbe:
            httpGet: { path: /sentinela/api/health, port: 3000 }
            periodSeconds: 3
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet: { path: /sentinela/api/health, port: 3000 }
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
      restartPolicy: Always

---
apiVersion: v1
kind: Service
metadata:
  name: sentinela
  namespace: integra-prd
spec:
  type: ClusterIP
  selector:
    app: sentinela
  ports:
    - name: http
      port: 80
      targetPort: 3000

---
# Ingress próprio em integra-prd. nginx-ingress mergeia com o Ingress agregador
# do namespace kong (que já tem crm.ituran.sp/ → api-gateway-kong-proxy)
# por longest-prefix match. /sentinela/* vai pra cá; resto continua no Kong.
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sentinela-ingress
  namespace: integra-prd
spec:
  ingressClassName: nginx
  rules:
  - host: crm.ituran.sp
    http:
      paths:
      - path: /sentinela
        pathType: Prefix
        backend:
          service:
            name: sentinela
            port:
              number: 80
```

**Notas de alinhamento com o padrão Ituran (`itulink.yml`/`seq.yml`):**

- ConfigMap + Secret + Deployment + Service + Ingress num único arquivo, separados por `---`.
- Service em `ClusterIP` + Ingress nativo (igual `seq.yml`); **sem NodePort**.
- `ingressClassName: nginx` explícito (igual `supabase`/`keycloak` em `0-namespace.yml`).
- Imagem com tag versionada explícita (`:v0.1.0`) — sem `:dev`. Cada deploy é um commit no repo `pipeline` alterando essa linha.
- Sem `keel.sh` annotations — deploy via Azure DevOps.
- Probes idênticas em estrutura ao `seq.yml`, com `path: /sentinela/api/health` (basepath obrigatório — ver §12.0).
- DNS interno de `crm.ituran.sp` **já existe** apontando para o Ingress controller do cluster (vide `0-namespace.yml:138`). Sem nova entrada DNS necessária.

### 12.2 Como aplicar valores reais nos Secrets

O manifesto em §12.1 inclui o `Secret` com placeholders `REPLACE_ME`. Há duas opções, escolher uma:

**Opção 1 — Substituir antes de commitar (segue o padrão Ituran).**

Os outros apps em `pipeline/k8s/cluster-bra-prd/integra-prd/apps/` deixam senhas em base64 direto no YAML (ex.: `itulink.yml:9`, `seq.yml:9`). O repo `pipeline` é privado. Substituir os `REPLACE_ME` pelo valor codificado em base64:

```bash
echo -n "valor-real" | base64 -w 0
```

E trocar `stringData` por `data` no YAML. Commitar no repo `pipeline`.

**Opção 2 — Secret separado fora do Git (mais higiênico).**

Aplicar o Secret manualmente uma vez (`kubectl apply -f /tmp/sentinela-secrets.yaml` com valores reais), e **remover o bloco `Secret` do manifesto público**. O Deployment continua referenciando o nome `sentinela-secrets`.

Confirmar com DevOps qual padrão a Ituran prefere antes de commitar.

### 12.3 Dockerfile — pós-Fase 4

```dockerfile
# syntax=docker/dockerfile:1.7

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps (cache estável, invalida só com package.json)
# ──────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 — build (TS → .output do Nitro via plugin tanstackStart)
# ──────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3 — deps de produção (sem dev deps); BuildKit pode paralelizar com stage 2
# ──────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# ──────────────────────────────────────────────────────────────────────────────
# Stage 4 — runtime (mínimo, non-root, read-only)
# ──────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

RUN apk add --no-cache tini && \
    addgroup -S -g 1001 sentinela && \
    adduser  -S -u 1001 -G sentinela sentinela

WORKDIR /app

COPY --from=build      --chown=sentinela:sentinela /app/.output      ./.output
COPY --from=prod-deps  --chown=sentinela:sentinela /app/node_modules ./node_modules
COPY --from=build      --chown=sentinela:sentinela /app/package.json ./package.json

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--enable-source-maps"

USER sentinela
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
```

**Notas:**

- `node:24-alpine` alinha com `integralake/web/Dockerfile`.
- BuildKit pode paralelizar `prod-deps` e `build` em build do zero; em CI com cache de layer o ganho é marginal.
- Sem `HEALTHCHECK`: probes do Kubernetes (§12.1) já cobrem; duplicar gera ruído.
- `tini` para signal handling correto durante rolling update.
- `runAsNonRoot` + `readOnlyRootFilesystem` + `capabilities: drop ALL`. Bibliotecas que precisarem escrever temp usam o `emptyDir` em `/tmp`.

**`.dockerignore` (raiz):**

```
.git
.github
node_modules
.output
.cache
*.log
.env
.env.*
data
docs
README.md
*.md
.vscode
.idea
coverage
test-results
playwright-report
```

### 12.4 Pipeline Azure DevOps — `pipeline/app/<categoria>/sentinela.yml`

Alinhado com o padrão `pipeline/app/integra/internalws.yml` e `pipeline/app/ai/iturin-web.yml`. Sem GitHub Actions.

**Decisão (§3 #7): Opção B — repo permanece em `github.com/ituran-bra/Sentinela`.**

O Azure DevOps consome o repo via GitHub Service Connection. Trade-off aceito: vira exceção dentro do padrão Ituran (todos os outros pipelines usam `type: git`/`TI/<repo>`), em troca de manter o histórico de PRs/issues no GitHub e não precisar manter dois remotes sincronizados.

**Pré-requisito de Azure DevOps:**

- [ ] Criar GitHub Service Connection em Project Settings → Service connections → New → GitHub. Nomear, por exemplo, `github-ituran-bra-sentinela`. Autorizar acesso ao repo `ituran-bra/Sentinela`.
- [ ] Importar a definição do pipeline (`pipeline/app/integra/sentinela.yml`) apontando para o repo via `resources.repositories[0].endpoint = github-ituran-bra-sentinela`.

**Opção A (registrada como alternativa futura)** — mover repo para Azure DevOps `TI/sentinela`:

```bash
# Caso um dia decida mover, o passo é reversível:
git remote add azure https://dev.azure.com/ituran/TI/_git/sentinela
git push azure --all && git push azure --tags
```

Não é o caminho escolhido para a v1.6 do plano.

#### Pipeline mínimo (recomendação para começar)

Em vez de extender o template `_templates/pipeline-build-images.yml` (que tem 540 linhas com Veracode, frontend deploy via Static Web Apps, mirror, DR, MEX — overkill pro Sentinela), começar com um pipeline enxuto. Migrar para o template oficial só se quiser security scan automático.

`pipeline/app/integra/sentinela.yml`:

```yaml
# Pipeline mora em TI/pipeline/app/integra/sentinela.yml.
# Trigger é definido no recurso `sentinela` (GitHub).
trigger: none

resources:
  repositories:
    - repository: sentinela
      type: github
      name: ituran-bra/Sentinela
      ref: master
      endpoint: github-ituran-bra-sentinela    # GitHub Service Connection
      trigger:
        branches:
          include: [master]
    - repository: pipeline
      type: git
      name: TI/pipeline
      ref: master

pool:
  name: linux-agent-bra

variables:
  - group: INTEGRA
  - name: appName
    value: sentinela
  - name: imageTag
    value: $(Build.BuildNumber)

stages:
- stage: build
  displayName: Build & Push image
  jobs:
  - job: build
    steps:
      - checkout: sentinela
        persistCredentials: true

      - script: echo "##vso[build.updatebuildnumber]1.0.$(Build.BuildId)"
        displayName: Update build number

      - task: Docker@2
        displayName: Login to ACR
        inputs:
          command: Login
          containerRegistry: ituran-acr

      - task: Docker@2
        displayName: Build & Push image
        inputs:
          command: buildAndPush
          containerRegistry: ituran-acr
          repository: integra/$(appName)
          Dockerfile: Dockerfile
          buildContext: $(System.DefaultWorkingDirectory)
          tags: |
            $(imageTag)
            latest

      - script: |
          echo "##vso[task.uploadsummary]Image: ituran.azurecr.io/integra/$(appName):$(imageTag)"
          echo "Bump da tag para deploy: editar pipeline/k8s/cluster-bra-prd/integra-prd/apps/sentinela.yml"
        displayName: Summary

- stage: bumpManifest
  displayName: Bump tag em pipeline/k8s/.../sentinela.yml
  dependsOn: build
  condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/master'))
  jobs:
  - job: bump
    steps:
      - checkout: pipeline
        persistCredentials: true

      - script: |
          set -euo pipefail
          file="k8s/cluster-bra-prd/integra-prd/apps/sentinela.yml"
          new_tag="$(imageTag)"
          # Atualiza a linha "image: ituran.azurecr.io/integra/sentinela:vX.Y.Z"
          sed -i -E "s#(image: ituran\\.azurecr\\.io/integra/sentinela:)[^\"'[:space:]]+#\\1${new_tag}#" "$file"
          git config user.email "azure-devops@ituran.sp"
          git config user.name  "azure-devops-bot"
          git add "$file"
          if git diff --cached --quiet; then
            echo "Sem mudança — tag já é $(imageTag)"
          else
            git commit -m "deploy(sentinela): bump tag para $(imageTag)"
            git push origin HEAD:master
          fi
        displayName: Atualiza tag e commita no repo pipeline
```

**O que esse pipeline faz:**

1. **Trigger** em qualquer push em `master` do repo Sentinela.
2. **Stage `build`**: login ACR, `docker buildAndPush` com tag versionada (`1.0.$(Build.BuildId)`) e `latest`.
3. **Stage `bumpManifest`**: faz checkout do repo `TI/pipeline`, edita o `apps/sentinela.yml` para apontar pra nova tag, comita e dá push em `master`.
4. **Pipeline do cluster** (`pipeline/k8s/cluster-bra-prd.yml`) detecta a mudança em `k8s/cluster-bra-prd/*` e executa `kubectl apply` automaticamente.

#### Quando migrar para o template oficial `_templates/pipeline-build-images.yml`

Migrar quando precisar de:

- **Veracode SAST/SCA/DAST** automático.
- **Promoção por branch** (`desenv` → dev, `release` → stg → prd) — útil quando o Sentinela tiver vários ambientes.
- **Stages mex/par/mir/dr** — só se o Sentinela for replicado para outras regiões/clusters.

Hoje o Sentinela é monobranch (master), single-cluster (bra-prd). Pipeline mínimo cobre 100% do caso. Migrar para o template oficial é trabalho extra sem ganho imediato.

#### Pré-requisitos no Azure DevOps

| Recurso | Como criar |
|---|---|
| Service connection `ituran-acr` | Já existe no projeto TI (compartilhada com `internalws`, `iturin-web`, etc.). |
| Variable group `INTEGRA` | Já existe (vide outros pipelines). |
| Pool `linux-agent-bra` | Já existe (vide `cluster-bra-prd.yml`). |
| Permissão de push em `TI/pipeline` para o build agent do Sentinela | Adicionar o build identity do pipeline `sentinela` como `Contributor` no repo `TI/pipeline` (Project Settings → Repos → pipeline → Security). |
| Permissão de checkout do `TI/pipeline` no pipeline `sentinela` | Em Pipelines → sentinela → Edit → Resources → autorizar o repo `pipeline`. |
| GitHub Service Connection (`github-ituran-bra-sentinela`) | Já confirmado pelo Owner que mantém o repo no GitHub (Opção B do §12.4). |

#### Divergências em relação ao padrão Ituran (e justificativas)

| Item | Padrão Ituran | Sentinela | Justificativa |
|---|---|---|---|
| Template do pipeline | extends `_templates/pipeline-build-images.yml` (540 LOC, com Veracode + multi-stage prom) | pipeline mínimo inline (~50 LOC) | Sentinela é monobranch monoambiente; template completo é overkill. Migrar quando precisar. |
| Promoção de tag por branch | `release` → stg/prd | `master` → prd direto | Sentinela é dashboard interno, sem ambiente de homologação separado. Validação pós-deploy via probes. |
| Bump da tag em `pipeline/.../apps/` | manual (DevOps edita o arquivo a cada release) | automático (stage `bumpManifest`) | Reduz fricção; cada commit em `master` do Sentinela = deploy em prd. Reverter = `git revert`. |

### 12.5 Aplicar no cluster

O deploy é totalmente automatizado pelos 2 pipelines Azure DevOps:

1. **Push em `master`** do repo `github.com/ituran-bra/Sentinela` → dispara `pipeline/app/integra/sentinela.yml` (via GitHub Service Connection):
   - Stage `build`: cria imagem `ituran.azurecr.io/integra/sentinela:1.0.<BuildId>`.
   - Stage `bumpManifest`: edita `pipeline/k8s/cluster-bra-prd/integra-prd/apps/sentinela.yml` com a nova tag e comita no repo `TI/pipeline`.
2. **Commit em `TI/pipeline/master`** → dispara `pipeline/k8s/cluster-bra-prd.yml` (já existente):
   - Executa `_pipeline.sh cluster-bra-prd $(Build.SourceVersion)`.
   - `kubectl apply` em todos os manifestos alterados, incluindo `apps/sentinela.yml`.
3. **Probes do k8s** validam o catch-up; pod fica `Ready` quando `/api/health` retorna `ready: true`.

Para verificar manualmente:

```bash
kubectl -n integra-prd rollout status deploy/sentinela
kubectl -n integra-prd logs -f deploy/sentinela
kubectl -n integra-prd get ingress sentinela-ingress
```

Acesso: `https://crm.ituran.sp/sentinela` (DNS já está apontando para o Ingress controller; nginx-ingress agrega o novo path automaticamente).

### 12.6 Adaptação pré-Fase 4

Antes da Fase 4 o repo é `backend/` + `frontend/`. Duas opções:

**Opção 1 — Aguardar Fase 4** (recomendado): faça a migração antes do primeiro deploy. Evita Dockerfile descartável em poucas semanas.

**Opção 2 — Dockerfile híbrido temporário:**

```dockerfile
FROM node:24-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend ./
RUN npm run build      # produz frontend/dist

FROM node:24-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY backend ./
RUN npm run build      # produz backend/dist

FROM node:24-alpine AS runtime
RUN apk add --no-cache tini && \
    addgroup -S -g 1001 sentinela && \
    adduser  -S -u 1001 -G sentinela sentinela
WORKDIR /app
COPY --from=backend-build  /app/backend/dist          ./dist
COPY --from=backend-build  /app/backend/package.json  ./package.json
COPY --from=backend-build  /app/backend/node_modules  ./node_modules
COPY --from=frontend-build /app/frontend/dist         ./public
ENV NODE_ENV=production PORT=3001
USER sentinela
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
```

E o backend precisa servir o frontend estático. Em **Express 4** (versão atual do projeto):

```ts
import path from "path";
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
```

> Em Express 5, a sintaxe `app.get("*", ...)` exige `/*splat`. Como o projeto usa Express 4, o snippet acima funciona; documentado aqui caso uma atualização aconteça antes da Fase 4.

Trocar a porta do Service de 3000 → 3001 no manifesto se essa rota for adotada.

---

## 13. Rollback por fase

| Fase | Rollback técnico | Rollback no cluster |
|---|---|---|
| 1 (SQLite) | `git revert <merge>` no repo `ituran-bra/Sentinela`. Pipeline Azure DevOps rebuilda automaticamente via GitHub trigger. | Bump da tag em `pipeline/.../apps/sentinela.yml` para a versão anterior + commit (ou aguardar o pipeline do revert atualizar) |
| 2 (cortes) | Idem | Idem |
| 3 (componente genérico) | `git revert <merge>`. Componentes antigos voltam (não foram deletados até o último commit). | Idem |
| 4 (TanStack Start) | `git revert <merge>` reativa Express. Rebuild com Dockerfile híbrido (§12.6). Reinstala `express`. | Idem |
| 5 (Query/Table) | Idem 1 | Idem 1 |
| 6 (charts) | Idem 1 | Idem 1 |
| 7 (PDF refactor) | Idem 1; baselines de SHA-256 confirmam regressão | Idem 1 |
| 8 (cleanup) | Idem 1 | Idem 1 |

**Rollback emergencial em prod:**

Caminho preferido (Azure DevOps reaplica): commit reverso no repo `TI/pipeline` voltando a tag em `apps/sentinela.yml` para a versão anterior.

```bash
# Editar pipeline/k8s/cluster-bra-prd/integra-prd/apps/sentinela.yml:
#   image: ituran.azurecr.io/integra/sentinela:1.0.231  ← versão ruim
#   image: ituran.azurecr.io/integra/sentinela:1.0.227  ← versão estável anterior
# (consultar histórico de tags no ACR via portal ou:
#   az acr repository show-tags -n ituran --repository integra/sentinela --orderby time_desc)

git -C /home/rcamara/Repos/pipeline commit -am "rollback sentinela 1.0.231 -> 1.0.227"
git -C /home/rcamara/Repos/pipeline push origin master
```

O pipeline `cluster-bra-prd` detecta o commit e re-aplica em segundos.

Caminho de emergência (sem aguardar pipeline):

```bash
kubectl -n integra-prd rollout history deploy/sentinela
kubectl -n integra-prd rollout undo deploy/sentinela --to-revision=N
# Importante: lembrar de commitar no TI/pipeline DEPOIS,
# senão o próximo deploy do Azure DevOps vai re-aplicar a versão ruim.
```

---

## 14. Observabilidade pós-deploy

A própria app monitora Datadog — paradoxo previsível. Mesmo assim, instrumentar:

- **Logs estruturados** (JSON) em stdout: o accumulator já loga; padronizar com timestamp/level/component.
- **Métrica básica via Datadog Agent** (DaemonSet do cluster): CPU/mem/restarts já cobertos pelo agente. Adicionar tags `service:sentinela`, `env:dev`/`env:prd`.
- **Notificação de deploy do Azure DevOps** publicada em Slack/Teams: configurar no pipeline `pipeline/k8s/cluster-bra-prd.yml` para alertar Owner técnico em falha de `kubectl apply`.
- **Alertas mínimos** (Datadog ou similar):
  - Pod `sentinela` em `CrashLoopBackOff`.
  - Restarts > 3 em 1h.
  - `/api/health` retorna 503 por > 60s após startup completo.
  - Catch-up do accumulator > 60s (ler do log estruturado).

---

## 15. Custos

### 15.1 Azure OpenAI Foundry

- Recurso: `iturin-ai-eastus2-resource` (subscription `c36f7b45-…`, RG `IA`, region `eastus2`).
- Deployment: `sentinela` (modelo subjacente decidido pela equipe IA).
- Uso: apenas no endpoint `GET /api/report/threat`, **sob demanda** (não automático).
- Estimativa: ~10–30 chamadas/dia × ~3.000 input + ~600 output tokens.
- Aprovador de orçamento: Tech lead + Equipe IA (recurso compartilhado).
- Custo monitorado pela própria conta Azure da Ituran; quota do deployment configurada pela equipe IA. Sem cartão separado.

### 15.2 Azure Container Registry

- Espaço usado por triple-tag + `:buildcache` ≈ 600 MB por versão.
- Política de retenção: manter as 10 últimas tags `vX.Y.Z` + `:dev` + `:latest` + `:buildcache`. Configurar via portal ACR.

### 15.3 Cluster k8s

- Recursos: 1 réplica × (256Mi req / 768Mi limit) — desprezível em cluster compartilhado.

---

## 16. Métricas de sucesso

| Métrica | Hoje | Alvo (mantendo Fase 4) | Alvo (Plano B sem Fase 4) |
|---|---:|---:|---:|
| LOC total (`cloc`, sem brancos/comentários/`ui/`/docs) | 8.371 | 6.339 | 6.569 |
| LOC backend | 2.452 | ~1.870 | ~1.970 |
| LOC frontend (TS/TSX) | 5.853 | ~4.400 | ~4.530 |
| Dependências de runtime removidas | — | −7 | −2 |
| Repositórios/diretórios separados | 2 (backend, frontend) | 1 (mono) | 2 (mantém) |
| Camadas entre UI e lógica de servidor | 3 (Express → axios → React) | 1 (server function) | 2 (Express → tRPC) |
| Tempo de boot do backend (sem cursor) | ~3-5s | ≤ 30s | ≤ 30s |
| Tempo de boot do backend (com cursor, dev) | n/a | ≤ 5s | ≤ 5s |
| Features perdidas | — | 0 | 0 |

---

## 17. Histórico de revisões

| Versão | Data | Autor | Mudança |
|---|---|---|---|
| 1.0 | 2026-04-25 | Owner técnico | Versão inicial do plano com 8 fases. |
| 1.1 | 2026-04-26 | Owner técnico (após review crítica externa) | Correções de erros executáveis em workflow/Dockerfile/manifesto k8s; alinhamento de branch (`master`), Node 24, paths do workflow; sintaxe correta de health endpoint para TanStack Start; cursor file documentado como dev-only; `maxSurge: 0` para evitar polling duplo no rollout; adicionado: TOC, glossário, RACI, rollback, pré-requisitos, observabilidade, custos, plano B explícito da Fase 4, decisão de retenção 7d formalizada, modelo Anthropic via env var, Playwright snapshots e SHA-256 de PDF como critérios de aceite. |
| 1.2 | 2026-04-26 | Owner técnico (após segunda revisão) | Vinxi removido das dependências e da descrição da Fase 4 — TanStack Start em 2026 usa `@tanstack/react-start/plugin/vite` + Nitro como builder, alinhado com `integralake/web/vite.config.ts`. Sumário ajustado de `~4.490` para `~4.590` (corte 29%) — soma das fases revalidada. Range otimista da Fase 4 corrigido de `+20` para `0`. Critério de cancelamento da Fase 4 reescrito sem ambiguidade ("downgrade do Vinxi/Nitro" → "regressão sem workaround in-app"). `livenessProbe.initialDelaySeconds` removido (redundante com `startupProbe`). Pré-requisito de Node 24 explícito. Nota sobre dev em container e `SNAPSHOT_PATH`. Nota sobre warning esperado no primeiro build pelo `cache-from`. Esclarecimento sobre não double-counting Fase 4/5. Terminologia "Segurança/Compliance" unificada para "Segurança". |
| 1.3 | 2026-04-26 | Owner técnico + DevOps | Owner = Miguel Oliveira (`miguelgos`); DevOps = Rodolfo Camara. Aprovações coletadas: retenção 7d (Segurança) e MSSQL egress (Infra). Manifesto k8s migrado de NodePort+Keel (padrão `integralake`) para Ingress+Azure DevOps (padrão Ituran `pipeline/k8s/cluster-bra-prd/integra-prd/apps/`). Manifesto único alinhado com `itulink.yml`/`seq.yml`: ConfigMap + Secret + Deployment + Service ClusterIP + Ingress. Hostname recomendado: `sentinela.ituran.sp` (mesma convenção de `seq-prd.ituran.sp`/`itur.in`); 3 opções listadas em §12.0. Decisão pendente sobre NodePort 32510 substituída por hostname público (§4.3). Fluxo de deploy revisto: GitHub Actions builda imagem; Azure DevOps aplica manifest no commit em `pipeline/`. RACI preenchida com nomes reais. Rollback adaptado para o fluxo Azure DevOps. |
| 1.4 | 2026-04-26 | Owner técnico + DevOps | **Build movido de GitHub Actions para Azure DevOps**, alinhando 100% com o padrão Ituran. Removido `.github/workflows/build.yml`. Adicionado `pipeline/app/integra/sentinela.yml` com 2 stages: `build` (`Docker@2 buildAndPush` em `ituran.azurecr.io/integra/sentinela`) e `bumpManifest` (auto-edita `pipeline/k8s/.../apps/sentinela.yml` e comita no `TI/pipeline`). Repo Sentinela movido de `github.com/Miguelgos/Sentinela` para `dev.azure.com/ituran/TI/_git/sentinela` (Opção A do §12.4); GitHub mantido como mirror opcional. Pipeline mínimo (~50 LOC) em vez de extender o template oficial `_templates/pipeline-build-images.yml` (540 LOC) — migrar para o template só quando precisar de Veracode + multi-ambiente. Pré-requisitos atualizados: GitHub secrets removidos; service connections / pools / variable groups Azure DevOps confirmados. RACI sem mudança. Rollback continua sendo bump da tag no repo `TI/pipeline`. |
| 1.5 | 2026-04-26 | Owner técnico | **Hostname definido: `crm.ituran.sp/sentinela`** (path-based routing). Confirmado que `crm.ituran.sp` já existe no Ingress agregador `integra-prd-ingress` (namespace `kong`, `0-namespace.yml:138`) — DNS interno já mapeado, sem dependência de Infra. Ingress controller é nginx-ingress com `ingressClassName: nginx`. Ingress próprio do Sentinela em `integra-prd` agrega via longest-prefix match (sem necessidade de editar `0-namespace.yml` do kong). Decisão #8 adicionada às Decisões Tomadas (substitui pendência §4.3 que foi removida). Implicações documentadas: (a) Vite `base: '/sentinela/'`; (b) TanStack Router `basepath: '/sentinela'`; (c) probes do k8s passam a usar `/sentinela/api/health`; (d) snippet de `vite.config.ts` adicionado à Fase 4. Manifesto k8s atualizado: Ingress aponta para `crm.ituran.sp` com path `/sentinela`, `ingressClassName: nginx`. Risco 9.8 reescrito (não é mais sobre hostname indisponível, mas sobre merge dos 2 Ingresses em nginx-ingress). |
| 1.6 | 2026-04-27 | Owner técnico | **Repo permanece no GitHub** (Opção B do §12.4) — à época, hospedado em `github.com/Miguelgos/Sentinela`. Pipeline Azure DevOps usa GitHub Service Connection (`github-miguelgos-sentinela`); `resources.repositories[0]` configurada com `type: github, name: Miguelgos/Sentinela, endpoint: github-miguelgos-sentinela`. Move-repo (Opção A) deixa de ser pendência e vira alternativa registrada. **LLM: troca Anthropic API direta por Azure OpenAI Foundry interno** (Decisão #9): endpoint `https://iturin-ai-eastus2-resource.openai.azure.com/openai/v1` (recurso `iturin-ai-eastus2-resource`, RG `IA`, region `eastus2`), deployment `sentinela`. SDK passa de `@anthropic-ai/sdk` para `openai` (oficial; mesmo SDK serve para Azure via `baseURL`). Suporta streaming via `responses.stream()` — incluído snippet de referência na Fase 2 com versão non-stream e stream. Env vars: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY` (Secret); removidas `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`. ConfigMap e Secret do manifesto k8s atualizados. Decisão pendente §4.2 reescrita: validar conectividade do endpoint Azure interno (em vez de `api.anthropic.com`); §4.3 nova: deployment `sentinela` configurado pela equipe IA. RACI ganha "Equipe IA" como Consultado para aprovação Azure OpenAI. Pré-requisito de rotação da API key adicionado (chave foi compartilhada em chat). Cliente `lib/geminiClient.ts` será renomeado para `lib/aiClient.ts` na Fase 2. Detector custom de `PROXY_BLOCKED` removido (endpoint interno torna-o desnecessário). Custos §15.1 redirecionados para conta Azure da Ituran (sem cartão separado). Glossário atualizado com entrada "Azure OpenAI Foundry (Ituran)". |
| 1.7 | 2026-04-27 | Owner técnico | **Ownership do repo será transferido para a org `ituran-bra` no GitHub.** Atualizadas todas as referências do estado-alvo: URL → `github.com/ituran-bra/Sentinela`; GitHub Service Connection renomeada de `github-miguelgos-sentinela` para `github-ituran-bra-sentinela`. Adicionado pré-requisito operacional em §11: transferência precisa estar concluída antes da SC final ser configurada (pode-se criar uma SC temporária apontando para `Miguelgos/Sentinela` durante a transição e atualizar o `endpoint` do pipeline após o transfer). Owner técnico (Miguel Oliveira, handle `miguelgos`) permanece — apenas o ownership do repo muda de pessoal para organizacional. Histórico das versões 1.0–1.6 preservado (referências a `Miguelgos/Sentinela` mantidas onde refletem o estado daquela versão). |
| 1.8 | 2026-04-27 | Owner técnico | **Re-baseline após pull do `ituran-bra/Sentinela`** (commits `d4478ac` Grafana/Prometheus + `9eb9141` Loki/Audit). Baseline cresceu de 6.472 → 8.371 LOC (+29%). Backend ganhou `lib/grafanaClient.ts` (84), `lib/lokiClient.ts` (66), `routes/grafana.ts` (204), `routes/audit.ts` (258) e `routes/report.ts` cresceu +61. Frontend ganhou `KubernetesAnalysis.tsx` (415), `JobSchedulerAnalysis.tsx` (320), `AuditAnalysis.tsx` (573). Total de **15 regras** de correlação no Relatório (+Rule 13 PROMETHEUS_ALERT, +Rule 14 DEPLOYMENT_DOWN, +Rule 15 JOBSCHEDULER_ERRORS). Decisão #10 adicionada: Grafana (`http://grafana-prd.ituran.sp`) com Bearer token; UIDs de datasource `prometheus` e `P73FAD9A5042C01FF` (Loki integra-audit). Fase 2 ampliada para consolidar grafanaClient + lokiClient num único `lib/grafana.ts` (saldo da Fase 2 sobe de −85 para −135). Fase 5 (TanStack Query) sobe de −200 para −250 e Fase 6 (charts) de −300 para −350 porque cobrem mais componentes agora. Telas novas (Kubernetes/JobScheduler/Audit) ficam **fora** do componente genérico da Fase 3 (UI específica). Meta consolidada nova: 8.371 → ~6.339 LOC (corte de ~24%) — saldo absoluto subiu de 1.882 para 2.032 LOC. Pré-requisitos §11 incluem `grafana-prd.ituran.sp:80` no egress e `GRAFANA_TOKEN` no Secret. ConfigMap k8s ganha `GRAFANA_URL`; Secret ganha `grafana-token`. Glossário atualizado com Grafana, Loki e Prometheus. Risco 9.12 novo: indisponibilidade Grafana e UID hardcoded. |
| 1.9 | 2026-04-27 | Owner técnico | **Fase 9 nova: reorganização da documentação.** Saldo 0 LOC de código (não toca `*.ts`/`*.tsx`); valor é descobribilidade. Estrutura proposta: `docs/architecture/adr/` (ADRs movidos de `docs/adr/`), `docs/architecture/{data-model,polling-flow,extraction}.md` (extraídos de `spec.md` §5/§6/§7), `docs/specs/pages/*.md` (1 arquivo por tela: 12 telas) e `docs/specs/integrations/*.md` (1 por integração: 6 hoje). `spec.md` (430 LOC) é dissolvido — substituído por `docs/specs/README.md` com índice. 3 telas novas (Kubernetes/JobScheduler/Audit) e 3 integrações sem doc hoje (Seq/Grafana/ituranweb) ganham documentação dedicada. Mapeamento `spec.md` → arquivos individuais explicitado em tabela. Fase 9 paralelizável com 1–7; coordenar com Fase 8 (que também toca docs). RACI inclui Fase 9 com R=Owner, A=Tech lead, C=Arquitetura. |

---

## Anexo A — Por que React + shadcn

Os commits recentes do repositório (a partir de `d5988d9`) são todos co-autorados com Claude Sonnet 4.6, indicando que a evolução do produto é assistida por IA. Trocar de stack para Svelte 5 / Solid otimizaria LOC mas introduziria atrito mensurável na geração assistida, porque:

1. **Volume de treino.** React + shadcn tem corpus desproporcionalmente maior nos datasets de modelos atuais.
2. **Padrões estáveis.** Hooks, JSX, props — reproduzíveis sem ambiguidade.
3. **Maturidade do corpus.** Svelte 5 runes (`$state`, `$derived`, `$effect`) são de outubro/2024, ainda em consolidação.
4. **Ferramentas adjacentes.** v0 (Vercel), Cursor, Copilot otimizam para React/shadcn.

A diferença teórica de LOC (~30% menos no Svelte) não compensa a perda de produtividade quando IA gera a maior parte do código de telas.

> **Nota:** este anexo é argumentativo, não normativo. A decisão #1 em §3 captura a posição firmada.
