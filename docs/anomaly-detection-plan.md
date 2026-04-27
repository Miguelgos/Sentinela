# Plano — Anomaly Detection no Sentinela

**Autor:** Equipe Sentinela
**Data:** 2026-04-27
**Status:** Proposta — aguardando aprovação técnica
**Audiência:** CTO / liderança técnica

---

## 1. Resumo Executivo

Adicionar capacidade de **detecção automática de anomalias** ao Sentinela, complementando o atual modelo de regras estáticas (Relatório de Ameaças, Kong Auth, Falhas de Auth). A solução proposta é **híbrida**: detecção estatística determinística (Z-score sobre baselines horárias) + narrativa em linguagem natural via Azure OpenAI já configurado.

**Investimento estimado:** 5-8 dias-pessoa, divididos em 3 fases incrementais.
**Custo operacional adicional:** desprezível (reutiliza acumulador in-memory; sem novas dependências externas).
**Risco técnico:** baixo — abordagem comprovada, dados já disponíveis.

---

## 2. Problema

Hoje o Sentinela detecta ameaças com base em **regras fixas com thresholds manuais** (ex: "≥5 falhas de auth em 10 min" = brute force). Esse modelo tem três limitações claras:

1. **Cego a desvios sutis.** Um pico de 30% no volume de erros num endpoint específico passa despercebido se ficar abaixo do threshold absoluto de 50 erros/hora.
2. **Cego ao "novo".** Um erro que nunca apareceu antes não dispara nenhuma regra — mesmo sendo um sinal forte de regressão ou ataque novo.
3. **Não considera padrões temporais.** Volume de tráfego que é normal às 14h pode ser anômalo às 4h da manhã. As regras atuais não fazem essa distinção.

Anomaly detection cobre justamente esses pontos cegos sem substituir as regras existentes — as duas abordagens são complementares.

---

## 3. Abordagem Proposta

### 3.1. Detectores

Lista priorizada por valor × esforço:

| # | Detector | Detecta | Método | Fase |
|---|----------|---------|--------|------|
| 1 | **Pico de erros** | Hora com volume de errors >> baseline da mesma hora-do-dia | Z-score horário (>2.5σ) | 1 |
| 2 | **Mensagem nova** | Erro que nunca apareceu nos últimos 7 dias | Set diff com clusterização por prefixo | 1 |
| 3 | **Burst de auth fail** | Falhas `/connect/token` concentradas em janela curta | Rate-of-change vs média móvel 24h | 1 |
| 4 | **Endpoint que começou a falhar** | `request_path` com taxa de erro saltando | Comparação última hora vs 24h anteriores | 2 |
| 5 | **User_id novo com volume** | Usuário inédito disparando muitos eventos | Set diff + threshold | 2 |
| 6 | **WAF burst** | Volume GoCache acima do baseline horário | Z-score horário | 2 |
| 7 | **Off-hours activity** | Volume entre 0h-6h acima do baseline | Z-score com filtro temporal | 2 |
| 8 | **Auditoria — acesso atípico** | Pessoa acessou páginas que nunca acessou | Set diff por (userId, page) | 3 |
| 9 | **Pod restart inesperado** | Restart fora de janela normal de deploy | Diff vs últimas 24h | 3 |

### 3.2. Por que Z-score?

Para cada métrica de volume (eventos/hora), calculamos a **média e desvio padrão dos últimos 7 dias** no mesmo slot hora-do-dia (ex: "toda segunda às 14h"). A hora atual é classificada por quantos desvios padrão está acima/abaixo da média:

- **Z > 2.5σ** → anomalia média
- **Z > 3.0σ** → anomalia alta
- **Z > 4.0σ** → anomalia crítica

Vantagens:
- **Determinístico e auditável** — qualquer analista consegue reproduzir o cálculo.
- **Adaptativo** — aprende sozinho o que é "normal" para cada hora-do-dia (madrugada, horário comercial, fim de semana são tratados separadamente).
- **Zero dependência externa** — roda em milissegundos sobre dados já em memória.
- **Honesto sobre incerteza** — quando o histórico for insuficiente, o detector se cala em vez de gerar ruído.

### 3.3. Camada de IA (narrativa)

Para cada anomalia detectada, o Azure OpenAI (deployment `sentinela`, já configurado) gera uma **frase explicativa em linguagem natural**:

> "Detectado pico de erros 3.2σ acima da média no endpoint `/api/quote/print` entre 14h e 15h — comportamento típico de regressão pós-deploy. Recomenda-se verificar deploys recentes e logs de exceção do serviço salesbo."

Isso reduz o tempo de compreensão para o time de operações e segue exatamente o mesmo padrão já usado no Relatório de Ameaças.

---

## 4. Arquitetura

```
accumulator.ts (Map in-memory, 7d, ~50k eventos)
     ↓
app/server/fn/anomaly.ts
     ├── detectors/errorRate.ts        # Detector #1
     ├── detectors/newMessage.ts        # Detector #2
     ├── detectors/authBurst.ts         # Detector #3
     └── ...
     ↓
{ anomalies: Anomaly[], baseline: Stats, generatedAt: ISO }
     ↓
Azure OpenAI (narrativa, opcional, paralelo)
     ↓
AnomalyAnalysis.tsx (frontend)
     ├── Cards de severidade (CRITICAL / HIGH / MEDIUM)
     ├── Timeline horária (visualização do desvio)
     └── Tabela detalhada por detector
```

**Tipo `Anomaly`:**
```typescript
{
  detector: "ERROR_RATE_SPIKE" | "NEW_MESSAGE" | "AUTH_BURST" | ...,
  severity: "CRITICAL" | "HIGH" | "MEDIUM",
  metric: number,           // valor observado
  baseline: number,         // valor esperado
  zScore: number,           // distância em sigmas
  evidence: string[],       // exemplos concretos
  narrative?: string,       // explicação IA
  detectedAt: string,       // ISO timestamp
}
```

**Princípios de design:**
- **Cada detector é uma função pura** `(events, history) → Anomaly[]` — testável isoladamente.
- **Sem persistência adicional** — baseline é recalculada a cada chamada (custo trivial sobre 50k eventos).
- **Tolerante a histórico insuficiente** — detector retorna lista vazia se não tiver 3+ dias de dados.
- **Configuração via `.env`** para thresholds (Z-score mínimo, tamanho da janela).

---

## 5. Plano de Implementação

### Fase 1 — MVP (3 dias)
**Entregáveis:**
- `anomaly.ts` com detectores #1, #2, #3
- Página `AnomalyAnalysis.tsx` no menu lateral
- Timeline horária + tabela de anomalias detectadas
- Testes unitários para cada detector
- Sem narrativa IA ainda (versão determinística pura)

**Critério de aceite:** dispara anomalia comprovada em pelo menos 1 caso real de pico de erros das últimas 7 dias.

### Fase 2 — Cobertura (2 dias)
**Entregáveis:**
- Detectores #4-#7 (endpoint, user_id, WAF, off-hours)
- Integração com Azure OpenAI para narrativa
- Exportação PDF (`exportAnomalyPdf`)

**Critério de aceite:** narrativa IA legível para pelo menos 80% das anomalias detectadas.

### Fase 3 — Auditoria & Infra (2-3 dias)
**Entregáveis:**
- Detectores #8 (auditoria — Loki) e #9 (pod restarts — Grafana)
- Integração no Relatório de Ameaças (anomalias entram como evidência)

**Critério de aceite:** anomalias de auditoria geram alerta acionável (caso real validado pelo time de segurança).

---

## 6. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Falsos positivos altos no início | Alta | Médio | Detector silencia se baseline tiver <3 dias. Threshold inicial conservador (2.5σ). Botão de feedback "marcar como falso positivo". |
| Histórico de 7 dias insuficiente para detectar sazonalidade semanal | Média | Baixo | Documentado explicitamente na UI. Roadmap futuro: persistir baselines em SQLite para histórico de 30+ dias. |
| Azure OpenAI indisponível | Baixa | Baixo | Detectores funcionam sem IA. Narrativa é cosmética, não bloqueia operação. |
| Performance — recalcular baseline a cada request | Baixa | Baixo | 50k eventos × 9 detectores ~= 50ms total. Cacheável por 60s se necessário. |
| Cobertura excessiva gera "alert fatigue" | Média | Alto | Severidade calibrada (>3σ = HIGH, >4σ = CRITICAL). UI prioriza top 5 críticos. |

---

## 7. Métricas de Sucesso

Avaliação após 30 dias em produção:

- **Detecções verdadeiramente acionáveis** ≥ 70% (medido por feedback do time de operações)
- **Tempo médio até detecção (MTTD)** reduzido em ≥ 30% para os tipos de incidente cobertos
- **Falsos positivos** < 2 por dia em estado estável
- **Adoção** — página acessada pelo menos 3x por semana pelo time

---

## 8. Tradeoffs Reconhecidos

**O que esta proposta NÃO faz:**

- Não usa ML supervisionado (não temos dataset rotulado; não compensa o esforço para o ganho marginal sobre Z-score).
- Não detecta correlações multi-variadas complexas (ex: "CPU alta + erros crescendo + WAF blocks aumentando" simultaneamente). Isso pode entrar em fase futura com técnicas mais sofisticadas (Isolation Forest, autoencoder).
- Não substitui as regras existentes — detecta complementarmente.
- Não tem persistência histórica das próprias detecções (cada chamada recalcula). Pode ser adicionado depois se o time precisar de "histórico de anomalias detectadas".

**Por que começar simples?** Z-score sobre buckets horários captura ~80% do valor de detecção de anomalias com ~10% do esforço de uma solução ML completa. Permite iterar com base em uso real antes de investir em complexidade.

---

## 9. Evolução Futura (fora deste escopo)

- **Persistência de baselines** em SQLite/PostgreSQL para janelas de 30/90 dias (capturar sazonalidade mensal).
- **Detecção multi-variada** (Isolation Forest sobre features extraídas).
- **Alertas push** (Slack / Teams / e-mail) quando anomalia CRITICAL é detectada.
- **Feedback loop** — analista marca falso positivo → ajuste automático de threshold.
- **Forecasting** — projeção de quando uma métrica vai cruzar threshold se a tendência continuar.

---

## 10. Decisão Solicitada

| Item | Decisão |
|------|---------|
| Aprovar Fase 1 (MVP, 3 dias)? | [ ] Sim  [ ] Não  [ ] Discutir |
| Aprovar Fases 2-3 condicionadas ao sucesso da Fase 1? | [ ] Sim  [ ] Não |
| Restrições orçamentárias / prazo? | _________________ |
| Stakeholders adicionais que devem revisar? | _________________ |
