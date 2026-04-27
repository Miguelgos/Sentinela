# ADR-011 — Relatório de Ameaças com Correlação de Regras + Azure OpenAI

> **Histórico de nomes:** este ADR foi criado como "relatorio-ameacas-gemini" porque o LLM original era o Google Gemini (`generativelanguage.googleapis.com`). A API estava bloqueada pelo Forcepoint na rede corporativa Ituran, levando à migração para Anthropic Claude (fase intermediária) e, por fim, ao Azure OpenAI Foundry interno — endpoint sem bloqueio de firewall.

## Status

Aceito

## Contexto

Cada fonte de dados (Seq, Datadog, GoCache, Grafana) fornece visões isoladas de eventos de segurança. Um analista precisava correlacionar manualmente tentativas de brute-force no Seq com eventos de injeção WAF no GoCache e alertas de monitor no Datadog para construir um panorama de ameaças.

## Decisão

- Criada a server function `app/server/fn/report.ts` expondo `getThreatReport()`.
- As 4 fontes são buscadas em paralelo via `Promise.allSettled` (falha de uma fonte não aborta o relatório).
- **14 regras de correlação** são aplicadas em sequência, cada uma produzindo um `CorrelatedThreat` com nível de risco (CRITICAL/HIGH/MEDIUM/LOW/INFO), evidências e indicadores:

  | # | Regra | Gatilho |
  |---|-------|---------|
  | 1 | BRUTE_FORCE | ≥5 falhas de auth em janela de 10 min por usuário |
  | 2 | ANOMALOUS_USERNAMES | Identificadores que não são e-mail tentando autenticar |
  | 3 | WAF_INJECTION | SQLi/XSS no GoCache WAF |
  | 4 | MULTI_SOURCE_IP | Mesmo IP em GoCache e logs Seq |
  | 5 | EXPIRED_CERTS | Expiração de certificado TLS nos logs Seq |
  | 6 | DATADOG_ALERT | Monitor em Alert ou Warn |
  | 7 | HIGH_ERROR_RATE | >50 eventos Error/Critical na última hora |
  | 8 | ACTIVE_INCIDENT | Incidente não resolvido no Datadog |
  | 9 | SCANNER_DETECTED | SQLMap, Nikto ou Dart detectados pelo WAF |
  | 10 | BOT_ATTACK | >100 bloqueios de bot em 24h |
  | 11 | INFRA_STRESS | CPU >85%, disco >90% ou reinicializações de pods |
  | 12 | GEO_CONCENTRATION | Concentração de ataques em CN, RU, KP, IR |
  | 13 | PROMETHEUS_ALERT | Alertas críticos ou >3 warnings no Alertmanager |
  | 14 | DEPLOYMENT_DOWN | Deployments com 0 réplicas em `integra-prd` |

- Após a avaliação das regras, um prompt estruturado (~400 palavras) é enviado ao **Azure OpenAI** (deployment `sentinela`, recurso `iturin-ai-eastus2-resource`, região `eastus2`) via `backend/src/lib/aiClient.ts`. O prompt solicita uma narrativa executiva em 4 seções em português: Resumo Executivo, Ameaças Prioritárias, Recomendações Imediatas e Avaliação de Risco.
- Autenticação: header `api-key: AZURE_OPENAI_KEY`. Endpoint configurável via `AZURE_OPENAI_ENDPOINT`.
- Fallback automático: se a API estiver indisponível, um resumo estático dos achados é retornado. O campo `narrativeError` é exposto na resposta para exibição no frontend.
- O componente `ReportAnalysis.tsx` gera o relatório sob demanda (clique em botão), exibe os achados com badges de risco coloridos e oferece exportação PDF via `exportThreatReportPdf`.

## Evolução do LLM

| Fase | Provedor | Motivo da troca |
|------|----------|-----------------|
| Original | Google Gemini | Bloqueado pelo Forcepoint na rede Ituran |
| Intermediário | Anthropic Claude (API direta) | `api.anthropic.com` acessível na rede |
| Atual | Azure OpenAI Foundry (interno) | Endpoint interno (`*.openai.azure.com`) — sem bloqueio, conta Azure da Ituran |

## Consequências

- (+) Uma única chamada fornece panorama correlacionado entre 4 fontes.
- (+) A narrativa IA reduz o tempo de compreensão para stakeholders não técnicos.
- (+) `Promise.allSettled` garante resultados parciais quando uma fonte está indisponível.
- (+) Endpoint Azure interno — sem dependência de acesso externo à internet.
- (-) O relatório é pontual (sem tendências históricas) — aceitável para uso operacional.
- (-) A qualidade depende da estrutura do prompt — validado contra dados reais de produção.
