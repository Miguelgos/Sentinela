# Plano — Anomaly Detection Fase 4: Fontes Externas + Janela de 10 dias

**Autor:** Equipe Sentinela
**Data:** 2026-05-06
**Status:** Aprovado pelo CTO — em implementação (Fase 4.0)
**Predecessor:** [anomaly-detection-plan.md](./anomaly-detection-plan.md) (Fases 1-3 já em produção)

---

## 1. Resumo Executivo

Estender a detecção de anomalias estilo Davis para **todas as fontes** consumidas pelo Sentinela (GoCache WAF/Bot/Firewall, Loki audit, Datadog) e **ampliar a janela de 7 → 10 dias**. Tudo permanece **in-memory** (sem dependência de Redis ou banco) — usa estrutura híbrida que separa o que é necessário pra detecção (contagens compactas) do que é necessário pra investigação (eventos brutos recentes).

**Investimento estimado:** 5-7 dias-pessoa em 4 sub-fases.
**Custo de memória adicional:** ~40MB (vs ~150MB atual só com Seq raw).
**Risco técnico:** baixo — reaproveita 100% dos primitivos da Fase 1.
**Limitação aceita:** drill-down de eventos individuais limitado a 2h (vs 7d hoje só pra Seq).

---

## 2. Estratégia: Cache Híbrido

A insight central: **detector** e **drill-down de UI** têm necessidades opostas.

- **Detector Davis** precisa de séries temporais longas (10 dias × 1 ponto/min × N dimensões) — mas só **contagens**, não eventos.
- **`LogsTable` / `EventDetail`** precisa de eventos completos — mas só **recentes** (poucas horas).

Hoje o `accumulator.ts` mistura as duas necessidades num único store de 100k eventos × 7d. Resultado: 400MB de memória, não cabe outras fontes.

**Solução**: dois stores paralelos por fonte:

```
┌─────────────────────────────────────────────────────────┐
│                   bucketStore (10d)                     │
│  Map<source, Map<dimension, Float64Array(14400)>>       │
│  ~20MB total — alimenta detectores Davis                │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│                   eventStore (2h sliding)               │
│  Map<source, Map<eventId, RawEvent>>                    │
│  ~18MB total — alimenta LogsTable, EventDetail          │
└─────────────────────────────────────────────────────────┘
```

Ambos preenchidos pelo mesmo polling. Retenção independente: 10 dias para buckets, 2h para raw.

---

## 3. Estimativa de Volume

### 3.1. Premissas

| Fonte | Eventos/dia | Bytes/evento (compacto) | Dimensões relevantes |
|-------|-------------|-------------------------|----------------------|
| Seq | 50k | 4KB (atual) | ~50 (services, request_paths top, levels, source_contexts) |
| GoCache (WAF+Bot+FW) | 10k | 1KB | ~30 (attack types, countries, tools) |
| Loki audit (3 services) | 1.5k | 500B | ~50 (services × users top, IPs externos) |
| Datadog | metrics, não eventos | — | ~20 (pod restarts, CPU, disk, alerts active) |

Volumes calibrados em runtime — capturamos as top-N dimensões, descartamos cauda longa.

### 3.2. bucketStore — 10 dias

**Estrutura**: `Float64Array(14400)` por dimensão (10d × 1440 min).

| Fonte | Dimensões | Bytes por dim | Total |
|-------|-----------|---------------|-------|
| Seq | 50 | 115KB | 5.6MB |
| WAF | 30 | 115KB | 3.4MB |
| Audit | 50 | 115KB | 5.6MB |
| Datadog | 20 | 115KB | 2.3MB |
| **Total buckets** | | | **~17MB** |

### 3.3. eventStore — 2h sliding

| Fonte | Eventos em 2h | Bytes/evento | Total |
|-------|---------------|--------------|-------|
| Seq | 4.2k | 4KB | 17MB |
| WAF | 0.8k | 1KB | 0.8MB |
| Audit | 0.13k | 500B | 0.06MB |
| Datadog | métricas/snapshots | — | 0.3MB |
| **Total raw** | | | **~18MB** |

### 3.4. Total e folga

- **Total Fase 4 completa:** ~35MB
- **Container atual:** 768Mi limit
- **Memória total processo:** estimo ~150MB hoje → ~185MB pós-Fase 4 (folga ~75% no container)
- **Crescimento de tráfego seguro até:** ~3× volume atual antes de precisar repensar

---

## 4. Arquitetura

```
backend/src/timeseries/
  ├── bucketStore.ts          ← Map<source, Map<dim, Float64Array(14400)>>
  ├── eventStore.ts           ← Map<source, Map<eventId, RawEvent>> + TTL 2h
  └── types.ts                ← TimeSeries adapter, RawEvent

backend/src/accumulators/
  ├── seqAccumulator.ts       ← REFACTOR do accumulator atual
  ├── wafAccumulator.ts       ← novo
  ├── auditAccumulator.ts     ← novo
  └── infraAccumulator.ts     ← novo (Fase 4.4 opcional)

backend/src/anomaly.ts
  └── primitivos inalterados — TimeSeries vem do bucketStore
```

### 4.1. Contrato

```typescript
// bucketStore.ts
export interface BucketStore {
  bump(source: string, dimension: string, minute: number, n?: number): void;
  bumpMany(source: string, minute: number, increments: Record<string, number>): void;
  getSeries(source: string, dimension: string): TimeSeries;  // adapter para Float64Array → Map
  getDimensions(source: string): string[];
  rotateDay(source: string, oldestMinuteToKeep: number): void;  // shift array on retention
}

// eventStore.ts
export interface EventStore<T> {
  put(source: string, eventId: string, event: T, timestamp: number): void;
  get(source: string, eventId: string): T | undefined;
  list(source: string, sinceMinute?: number): T[];
  prune(source: string, oldestMinuteToKeep: number): void;
}
```

### 4.2. Retenção (sem código manual)

- **bucketStore**: shift do `Float64Array` a cada minuto que avança (operação O(1) com index circular). Nada explode.
- **eventStore**: `prune()` chamado pelo polling — remove eventos com timestamp <2h.

### 4.3. Adapter para detectores

Os detectores existentes usam `TimeSeries` (interface `Map<minute, count>`). Adapter trivial:

```typescript
function asTimeSeries(arr: Float64Array, baseMinute: number): TimeSeries {
  const buckets = new Map<number, number>();
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > 0) buckets.set(baseMinute + i, arr[i]);
  }
  return { dimension, buckets };
}
```

Detectores não mudam.

---

## 5. Plano de Implementação

### Fase 4.0 — Refactor: bucketStore + eventStore (1-2 dias)

**Entregáveis:**
- `backend/src/timeseries/{bucketStore,eventStore,types}.ts`
- Testes unitários — cobertura ≥80% (rotação de dia, prune, getSeries adapter, edge cases de Float64Array)
- Integração: `getEvents()` atual passa a chamar `eventStore.list("seq")` (zero quebra de API pra consumidores)
- `REFERENCE_WINDOW_DAYS` muda de 7 → 10 em `anomaly.ts`

**Critério de aceite:** detectores Seq da Fase 1-3 seguem disparando idênticos com 10d de baseline em vez de 7d (snapshot lado-a-lado em staging).

### Fase 4.1 — Refactor Seq Accumulator (1 dia)

**Entregáveis:**
- `backend/src/accumulators/seqAccumulator.ts` substitui `backend/src/accumulator.ts`
- Polling 60s escreve em `bucketStore` (50 dimensões: total, service, level, request_path top-30, source_context) e `eventStore` (raw, prune 2h)
- Backfill 10d na boot (sequencial dia-a-dia, padrão atual)
- `getEvents()` segue funcionando, mas serve apenas eventos das últimas 2h

**Critério de aceite:**
- Anomalias seguem disparando como antes
- Memória total do processo reduz (de ~400MB Seq raw → ~25MB Seq híbrido)
- `LogsTable` mostra aviso "Visualizando últimas 2h" se usuário tentar buscar mais antigo

### Fase 4.2 — WAF Accumulator (1-2 dias)

**Entregáveis:**
- `backend/src/accumulators/wafAccumulator.ts` — polling 60s consolidando WAF+Bot+Firewall do `gcFetch`
- Backfill 10d na boot
- Dimensões em bucketStore: `attack:*`, `country:*`, `tool:*`, `total`
- eventStore com raw events das últimas 2h
- Detectores em `anomaly.ts`:
  - `detectWafBurst` (multi-dim sobre bucketStore.waf)
  - `detectNewAttackOrigin` (set-diff de countries × histórico 10d)
- Aparece no `AnomalyAnalysis.tsx` (timelines) e Relatório de Ameaças (via `ruleCriticalAnomaly`, sem alteração)

**Critério de aceite:** detector dispara em pico sintético validado em sandbox; backfill 10d completa em <8min sem rate-limit.

### Fase 4.3 — Audit Accumulator (1-2 dias)

**Entregáveis:**
- `backend/src/accumulators/auditAccumulator.ts` — polling 60s das 3 queries Loki
- Backfill 10d (limitado pela retenção real do Loki — validar antes)
- Dimensões: `service:X`, `service:X:user:Y` (top 20), `service:X:external_ip`, `service:X:unmasked`
- Detectores:
  - `detectAuditOffHours` — usa `computeSeasonalBaseline` da Fase 3
  - `detectNewAuditUser` — set-diff de users × 10d com >10 acessos
  - `detectExternalIpSpike` — IP externo aparecendo com volume

**Critério de aceite:** 1 caso real validado de acesso off-hours pelo time de segurança.

### Fase 4.4 — Infra Accumulator Datadog (1 dia, opcional)

**Entregáveis:**
- Polling 5min do Datadog (métricas mudam devagar)
- Métricas em bucketStore: `pod_restarts:{deployment}`, `cpu_high:{host}`, `disk_high:{host}`, `alerts_firing`
- Detectores `detectPodRestartSpike`, `detectInfraOffHours`

---

## 6. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Tráfego Seq cresce >2× e estoura container | Média | Alto | Cap de top-N dimensões dinâmico; alerta proativo se memória passar 60% do limit |
| Cardinalidade alta (ex: muitos users no Audit) | Alta | Médio | Top-20 users por service, descarta cauda. Usuário fora do top-20 não tem detecção individual mas conta no total |
| Perda do eventStore em restart | Alta | Baixo | Aceitável — eventStore é só pra drill-down recente, perde 2h. bucketStore TAMBÉM perde, vai precisar resync 10d em ~10min (vs 5min atual) |
| Loki retention <10d em prod | Média | Médio | Validar com infra antes da Fase 4.3. Se retenção for menor, baseline cresce gradualmente após deploy |
| Queries Loki/GoCache lentas no backfill | Média | Médio | Sequencial dia-a-dia; honrar `Retry-After`; limit por chamada (já é o padrão) |
| Float64Array shift quebra ordenação após overflow | Baixa | Médio | Usar índice circular `(minute - epochOffset) % 14400` em vez de shift real — O(1) sem move de memória |
| `LogsTable` quebra com 2h de raw em vez de 7d | Alta | Médio | UI ajustada com banner "Visualizando últimas 2h. Para histórico completo, consulte Seq diretamente" |

---

## 7. Métricas de Sucesso

Avaliação após 30 dias da Fase 4 completa:

- **Cobertura:** 4 fontes com baseline 10d (Seq + WAF + Audit + Infra)
- **Anomalias acionáveis cross-source:** ≥50%
- **Falsos positivos:** <5/dia (estado estável)
- **MTTD ataques sofisticados:** reduzido em ≥40%
- **Memória do processo:** <250MB (folga >65% no container 768Mi)
- **Tempo de resync após restart:** <10min (vs 5min hoje, mas com 2× a janela e 4× as fontes)

---

## 8. Tradeoffs Reconhecidos

**O que esta proposta NÃO faz:**

- **Drill-down de eventos antigos:** depois de 2h um evento individual desaparece. Pra investigar incidentes históricos, vai ter que consultar Seq direto. Aceitável porque Seq tem retenção própria longa.
- **Persistência entre restarts:** todo store é in-memory. Resync 10d na boot leva ~10min. Aceito por simplicidade — Redis/SQLite ficam para quando isso for um problema real.
- **HA multi-instância:** uma instância só. Múltiplas teriam stores independentes — não viável sem persistência compartilhada.
- **Histórico de detecções:** anomalias detectadas não são persistidas. Cada call de `/anomalies` recalcula. Pode ser adicionado depois sem refactor.
- **Eventos brutos do Datadog:** Datadog é métrica, não evento — não tem `eventStore` significativo, só snapshots.

**Por que aceitar?** O ganho principal (10d de baseline em todas as fontes, com memória controlada) sai com 5-7 dias de esforço usando só primitivos JavaScript nativos. As partes que poderiam justificar Redis/banco (HA, persistência) são fases subsequentes que se beneficiam dessa fundação consolidada.

---

## 9. Decisão Solicitada

| Item | Decisão |
|------|---------|
| Aprovar Fase 4.0 (refactor para bucketStore + eventStore, 1-2 dias)? | [ ] Sim  [ ] Não  [ ] Discutir |
| Aprovar Fase 4.1 (refactor Seq accumulator) condicionada à 4.0? | [ ] Sim  [ ] Não |
| Aprovar Fase 4.2 (WAF) condicionada à 4.1? | [ ] Sim  [ ] Não |
| Aprovar Fase 4.3 (Audit) condicionada à 4.2? | [ ] Sim  [ ] Não |
| Aprovar Fase 4.4 (Infra Datadog)? | [ ] Sim  [ ] Não  [ ] Adiar |
| Validar volume real Seq (50k/dia é estimativa — confirmar em prod)? | [ ] Antes de aprovar  [ ] Em paralelo |
| Validar retenção real Loki (>10d)? | [ ] Antes 4.3  [ ] Em paralelo |
| Aceitar limitação de drill-down de eventos a 2h? | [ ] Sim  [ ] Discutir alternativa |

---

## 10. Referências

- [anomaly-detection-plan.md](./anomaly-detection-plan.md) — Fases 1-3 (precedente em produção)
- [Auto-adaptive thresholds — Dynatrace Docs](https://docs.dynatrace.com/docs/dynatrace-intelligence/anomaly-detection/auto-adaptive-threshold)
- `backend/src/accumulator.ts` — implementação atual (será substituída pela Fase 4.1)
- `backend/src/anomaly.ts` — primitivos `computeBaseline`/`detectAnomalies` reutilizados sem alteração
