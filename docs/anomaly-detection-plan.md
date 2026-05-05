# Plano — Anomaly Detection no Sentinela (Davis-style)

**Autor:** Equipe Sentinela
**Data:** 2026-05-04
**Status:** Aprovado pelo CTO — em implementação (Fase 1)
**Audiência:** CTO / liderança técnica
**Inspiração:** Dynatrace Davis AI (auto-adaptive thresholds + multi-dimensional baselining)

---

## 1. Resumo Executivo

Adicionar capacidade de **detecção automática de anomalias** ao Sentinela seguindo a metodologia comprovada do Dynatrace Davis AI: **auto-adaptive thresholds** baseados em percentil 99 + IQR sobre janela de 7 dias, com **baselining multi-dimensional** (por serviço, endpoint, nível) e **regra de gatilho 3-de-5 minutos** para evitar ruído de spikes únicos.

**Investimento estimado:** 7-10 dias-pessoa em 3 fases incrementais.
**Custo operacional adicional:** desprezível (reutiliza acumulador in-memory de 100k eventos × 7 dias).
**Risco técnico:** baixo — metodologia documentada e validada em produção pelo Dynatrace há anos.

---

## 2. Problema

Hoje o Sentinela detecta ameaças com **regras fixas e thresholds manuais** (ex: "≥5 falhas de auth em 10 min" = brute force). Esse modelo tem 4 limitações:

1. **Cego a desvios sutis.** Pico de 30% em erros de um endpoint passa despercebido se ficar abaixo do threshold absoluto.
2. **Cego ao "novo".** Um erro inédito não dispara nenhuma regra — mesmo sendo sinal forte de regressão.
3. **Não considera padrões temporais.** Volume normal às 14h pode ser anômalo às 4h da manhã.
4. **Sem dimensionalidade.** Threshold global ignora que `request_path=/api/login` tem perfil de erro completamente diferente de `/api/dashboard`.

Anomaly detection cobre esses pontos cegos **sem substituir** as regras existentes — abordagens complementares.

---

## 3. Metodologia Davis-style

### 3.1. Auto-adaptive threshold (núcleo)

Para cada série temporal monitorada (eventos/minuto):

```
Reference window  = últimos 7 dias
Baseline          = percentil 99 das medições por minuto
Signal fluctuation = IQR (P75 − P25)
Threshold         = Baseline + (n × Signal fluctuation)
```

**Por que P99 + IQR (e não média + σ)?**
- **P99** é robusto a outliers — 1 spike no histórico não infla a baseline.
- **IQR** captura variabilidade típica ignorando caudas — mais estável que desvio padrão.
- Validado em escala (Dynatrace usa em milhões de métricas).

### 3.2. Trigger 3-de-5 minutos

Anomalia só é registrada se a métrica violar o threshold em **pelo menos 3 minutos dentro de uma janela deslizante de 5 minutos**. Filtra:
- Spikes únicos (1 minuto isolado).
- Ruído de medição.

### 3.3. Multi-dimensional baselining

Cada combinação (entidade × dimensão) recebe **threshold próprio**:

| Dimensão | Exemplo | Por quê |
|----------|---------|---------|
| `service` | `salesbo`, `customer360`, `fieldservice` | Erros normais variam por serviço |
| `request_path` | `/api/quote/print` | Endpoint específico pode regredir sozinho |
| `level` | `Error`, `Critical` | Críticos têm distribuição diferente |
| `source_context` | `Microsoft.AspNetCore.*` | Contexto de log indica subsistema |

Não é "1 baseline pro app inteiro" — é 1 por dimensão relevante.

### 3.4. Seasonal baseline (Fase 3)

Para métricas com sazonalidade clara (volume off-hours, padrão semanal):

```
Baseline[hour-of-week] = P99 dos eventos no mesmo slot (ex: "toda segunda às 14h")
```

Cobre padrões diurnos e dia-da-semana.

### 3.5. Correlação de problemas (causal-lite)

Inspirado no Smartscape do Davis, **sem topologia automática**. Quando N anomalias são detectadas em janela curta:

1. **Source-based dedup**: anomalias do mesmo (service, request_path) → 1 problema.
2. **Time-based dedup**: anomalias em janela de 5 min → 1 problema.
3. **Topology-based dedup** (Fase 3): mapa estático declarativo `service → upstream` agrupa anomalias relacionadas.

Reduz alert fatigue: N anomalias viram M problemas (M ≪ N).

---

## 4. Arquitetura

```
backend/src/anomaly.ts                    ← espelha pattern de threat.ts
  ├─ types: TimeSeries, Baseline, AnomalyEvent, AnomalyProblem
  ├─ buildTimeSeries(events, dimensionExtractor)
  │     bucketiza por minuto, por dimensão
  ├─ computeBaseline(series, refWindowDays = 7)
  │     P99 + IQR por dimensão (Davis exato)
  ├─ detectAnomalies(series, baseline, n = 3, windowMin = 5)
  │     3-de-5 min violando threshold
  ├─ detectors[]:
  │     • errorRatePerService    (multi-dim: service)
  │     • errorRatePerEndpoint   (multi-dim: request_path)
  │     • authFailRate           (single-dim)
  │     • newMessage             (categorical, set-diff)
  │     • offHoursVolume         (seasonal, Fase 3)
  ├─ correlateProblems(anomalies)
  │     dedup fonte + tempo (+ topologia na Fase 3)
  └─ buildAnomalyPrompt() → aiNarrative()  (Fase 2)

app/server/fn/anomaly.ts                  ← createServerFn (igual report.ts)
frontend/src/components/AnomalyAnalysis.tsx
  ├─ Cards: total problemas, severidade máxima, anomalias por detector
  ├─ Banda de confiança: linha baseline + zona verde + picos vermelhos
  └─ Tabela: problemas correlacionados, evidências, narrativa
app/routes/anomalies.tsx                  ← nova rota no menu lateral
```

### Tipos principais

```typescript
type TimeSeries = {
  dimension: string;        // ex: "service:salesbo"
  buckets: Map<number, number>;  // minute-epoch → count
};

type Baseline = {
  dimension: string;
  p99: number;
  iqr: number;
  threshold: (n: number) => number;  // baseline + n*iqr
  sampleCount: number;      // pra silenciar se < 3 dias
};

type AnomalyEvent = {
  detector: "ERROR_RATE_SERVICE" | "ERROR_RATE_ENDPOINT" | "AUTH_BURST" | "NEW_MESSAGE" | "OFF_HOURS";
  dimension: string;
  metric: number;           // valor observado
  baseline: number;         // P99
  threshold: number;        // P99 + n*IQR
  violationsInWindow: number;  // ex: 4 de 5
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  detectedAt: string;       // ISO
  evidence: string[];
};

type AnomalyProblem = {
  id: string;
  anomalies: AnomalyEvent[];   // dedup'das em 1 problema
  rootDimension: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  narrative?: string;          // AI (Fase 2)
};
```

### Princípios de design

- **Cada detector é função pura** `(events, baselines) → AnomalyEvent[]` — testável isoladamente.
- **Sem persistência adicional na Fase 1** — baseline é recalculada a cada chamada (custo trivial sobre 100k eventos).
- **Tolerante a histórico insuficiente** — `Baseline.sampleCount < 3*1440` (3 dias × 1440 min) → detector retorna lista vazia.
- **Configuração via `.env`** para sensibilidade (n=3 default, janela 5 min).

---

## 5. Plano de Implementação

### Fase 1 — MVP "Davis-lite" (3-4 dias)

**Entregáveis:**
- `backend/src/anomaly.ts`: `buildTimeSeries`, `computeBaseline` (P99+IQR), `detectAnomalies` (3-de-5)
- 3 detectores: `errorRatePerService`, `authFailRate`, `newMessage`
- `app/server/fn/anomaly.ts` (server fn)
- `frontend/src/components/AnomalyAnalysis.tsx` com banda de confiança
- Rota `/anomalies` no menu lateral
- Testes unitários (`backend/src/anomaly.test.ts`) — cobertura ≥ 80% nas funções puras
- **Sem narrativa AI ainda**

**Critério de aceite:**
- P99+IQR computado corretamente em dataset sintético (validar com `vitest`).
- Anomalia disparada em ≥1 caso real comprovado dos últimos 7 dias.
- Página renderiza banda de confiança legível.

### Fase 2 — Multi-dim + Correlação + AI (2-3 dias)

**Entregáveis:**
- Detector `errorRatePerEndpoint` (per `request_path`)
- `correlateProblems()`: agrupa por (source, time-window) → `AnomalyProblem[]`
- Narrativa AI **por problema** (não por anomalia) via `aiNarrative()`
- Integração no Relatório de Ameaças: problema CRITICAL aparece como `CorrelatedThreat`
- Tabela na UI mostra problemas correlacionados, expansível pra anomalias

**Critério de aceite:**
- N anomalias relacionadas reduzem para M problemas (M < N) em caso real.
- Narrativa AI legível e específica em ≥80% dos problemas.

### Fase 3 — Sazonalidade + Topologia lite (3 dias, opcional)

**Entregáveis:**
- `seasonalBaseline`: P99+IQR por slot hour-of-week (separado do baseline default)
- Detector `offHoursVolume` (volume entre 0h-6h × baseline noturno)
- Mapa estático `backend/src/topology.ts` declarando dependências (`salesbo → identity`, `customer360 → integra`)
- `correlateProblems()` usa topologia: anomalias em services com relação → 1 problema com causa raiz inferida

**Critério de aceite:**
- Detector off-hours dispara em incidente sintético (script de carga às 3h).
- Causa raiz correta em ≥70% dos problemas multi-service em validação manual.

---

## 6. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Falsos positivos altos no início | Alta | Médio | (a) Detector silencia se baseline < 3 dias. (b) Threshold inicial conservador (n=3, equivale a ~2σ). (c) Botão "marcar como falso positivo" na UI. |
| Histórico de 7 dias insuficiente para sazonalidade semanal | Média | Baixo | Documentado na UI. Roadmap: persistir baselines em SQLite para 30+ dias. |
| Azure OpenAI indisponível | Baixa | Baixo | Detectores funcionam sem AI. Narrativa é cosmética. Padrão idêntico ao `report.ts` (já tem fallback). |
| Performance — recalcular baseline a cada request | Baixa | Baixo | 100k eventos × ~5 dimensões × ~10k buckets ≈ 50ms. Cache 60s se necessário. |
| Cobertura excessiva gera alert fatigue | Média | Alto | (a) Correlação reduz N → M problemas. (b) UI prioriza top 5 críticos. (c) Severidade calibrada (n=3 → MEDIUM, n=4 → HIGH, n=6 → CRITICAL). |
| Mapa de topologia (Fase 3) fica desatualizado | Média | Médio | Topologia opcional. Se mapa estiver vago, sistema funciona sem causalidade — só perde precisão de root cause. |

---

## 7. Métricas de Sucesso

Avaliação após 30 dias em produção:

- **Detecções verdadeiramente acionáveis** ≥ 70% (feedback do time de operações).
- **Tempo médio até detecção (MTTD)** reduzido em ≥ 30% para tipos cobertos.
- **Falsos positivos** < 2 por dia em estado estável.
- **Razão dedup** (anomalias → problemas) ≥ 2x (1 problema absorve ≥2 anomalias em média).
- **Adoção** — página acessada ≥3x/semana.

---

## 8. Tradeoffs Reconhecidos

**O que esta proposta NÃO faz:**

- **Não tem Smartscape automático.** Topologia (Fase 3) é declarativa. Quando arquitetura muda, mapa pode ficar desatualizado.
- **Não tem forecasting.** Davis prevê tráfego da próxima semana; aqui só comparamos com histórico.
- **Não usa ML supervisionado.** Sem dataset rotulado; abordagem estatística cobre ~80% do valor com 10% do esforço.
- **Não tem fault-tree analysis determinística.** Davis usa grafo causal rigoroso; aqui usamos heurísticas + AI.
- **Não substitui regras existentes.** Detecta complementarmente.
- **Não persiste detecções.** Cada chamada recalcula. Histórico vem em fase futura, se necessário.

**Por que é uma boa adaptação?** A metodologia **central** do Davis (P99+IQR, multi-dim, 3-de-5min, dedup causal) é replicável com baixo esforço. As partes que exigem instrumentação profunda (Smartscape, forecasting) são justamente as que entregam menos valor incremental para o nosso caso de uso.

---

## 9. Evolução Futura (fora deste escopo)

- **Persistência de baselines** em SQLite/PostgreSQL para janelas 30/90 dias.
- **Detecção multi-variada** (Isolation Forest sobre features extraídas).
- **Alertas push** (Slack/Teams/e-mail) em problemas CRITICAL.
- **Feedback loop** — analista marca falso positivo → ajuste automático de threshold.
- **Forecasting** — projeção de quando uma métrica vai cruzar threshold se tendência continuar.
- **Topologia automática** — descoberta via correlação de TraceId entre services.

---

## 10. Decisão Solicitada

| Item | Decisão |
|------|---------|
| Aprovar Fase 1 (MVP Davis-lite, 3-4 dias)? | [ ] Sim  [ ] Não  [ ] Discutir |
| Aprovar Fase 2 (multi-dim + correlação + AI) condicionada ao sucesso da Fase 1? | [ ] Sim  [ ] Não |
| Aprovar Fase 3 (sazonalidade + topologia lite)? | [ ] Sim  [ ] Não  [ ] Adiar |
| Restrições orçamentárias / prazo? | _________________ |
| Stakeholders adicionais que devem revisar? | _________________ |

---

## 11. Referências

- [Auto-adaptive thresholds — Dynatrace Docs](https://docs.dynatrace.com/docs/dynatrace-intelligence/anomaly-detection/auto-adaptive-threshold)
- [Multi-dimensional baselining — Dynatrace Docs](https://docs.dynatrace.com/docs/discover-dynatrace/platform/davis-ai/anomaly-detection/concepts/automated-multidimensional-baselining)
- [Event correlation (Smartscape) — Dynatrace Docs](https://docs.dynatrace.com/docs/dynatrace-intelligence/root-cause-analysis/event-analysis-and-correlation)
- [Davis AI Anomaly Detector on Grail (blog)](https://www.dynatrace.com/news/blog/create-a-davis-ai-anomaly-detector-on-grail/)
