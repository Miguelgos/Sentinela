# ADR-011 — Relatório de Ameaças com Correlação de Regras + Claude AI (Anthropic)

## Status

Aceito

## Contexto

Cada fonte de dados (Seq, Datadog, GoCache) fornece visões isoladas de eventos de segurança. Um analista precisava correlacionar manualmente tentativas de brute-force no Seq com eventos de injeção WAF no GoCache e alertas de monitor no Datadog para construir um panorama de ameaças. Essa correlação entre fontes era inteiramente manual.

## Decisão

- Criada a rota `routes/report.ts` expondo `GET /api/report/threat`.
- A rota busca as três fontes em paralelo via `Promise.allSettled` (resiliente — a falha de uma única fonte não aborta o relatório).
- 12 regras de correlação são aplicadas em sequência, cada uma produzindo um `CorrelatedThreat` com nível de risco (CRITICAL/HIGH/MEDIUM/LOW/INFO), lista de evidências e indicadores:
  1. BRUTE_FORCE — 5 ou mais falhas de autenticação em janela de 10 minutos por usuário
  2. ANOMALOUS_USERNAMES — tentativas de autenticação com identificadores que não são e-mail
  3. WAF_INJECTION — eventos de SQLi/XSS do WAF do GoCache (usando `classifyAlert()`)
  4. MULTI_SOURCE_IP — IPs presentes tanto nos bloqueios do GoCache quanto nos logs do Seq
  5. EXPIRED_CERTS — eventos de expiração de certificado TLS no Seq
  6. DATADOG_ALERT — monitores em estado Alert ou Warn
  7. HIGH_ERROR_RATE — mais de 50 eventos Error/Critical na última hora
  8. ACTIVE_INCIDENT — incidentes não resolvidos do Datadog `/api/v2/incidents`
  9. SCANNER_DETECTED — assinaturas de ferramentas ofensivas (SQLMap, Nikto, Dart) no User-Agent do GoCache
  10. BOT_ATTACK — mais de 100 bloqueios de mitigação de bots em 24 horas
  11. INFRA_STRESS — hosts com CPU acima de 85%, disco acima de 90% ou reinicializações de pods
  12. GEO_CONCENTRATION — volume de ataque concentrado em códigos de país de alto risco (CN, RU, KP, IR)
- Após a avaliação das regras, um prompt estruturado (limite de aproximadamente 400 palavras) é enviado ao **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) via `lib/geminiClient.ts` (nome mantido por compatibilidade interna). O prompt inclui contexto quantitativo e as regras disparadas, solicitando uma narrativa executiva em 4 seções em português (Resumo Executivo, Ameaças Prioritárias, Recomendações Imediatas, Avaliação de Risco).
- Autenticação via header `x-api-key` + `anthropic-version: 2023-06-01`. Endpoint: `POST https://api.anthropic.com/v1/messages`.
- Se a API estiver indisponível, um resumo estático de fallback é retornado. O cliente detecta bloqueios de proxy (HTTP 302/301 ou body vazio) e expõe `narrativeError` na resposta para exibição no frontend.
- O componente frontend `ReportAnalysis.tsx` gera o relatório sob demanda (clique em botão), exibe os achados com badges de risco coloridos e oferece exportação em PDF via `exportThreatReportPdf`.

## Consequências

- (+) Uma única chamada de API fornece um panorama de ameaças correlacionado entre as três fontes.
- (+) A narrativa gerada por IA reduz o tempo de compreensão para stakeholders não técnicos.
- (+) `Promise.allSettled` garante resultados parciais quando uma fonte está indisponível.
- (+) `api.anthropic.com` está acessível na rede corporativa Ituran (Forcepoint não bloqueia); `generativelanguage.googleapis.com` estava bloqueado e foi descartado.
- (-) A API requer acesso externo à internet e gerenciamento de chave de API (`ANTHROPIC_API_KEY`).
- (-) O relatório é pontual (sem tendências históricas) — aceitável para uso operacional.
- (-) A qualidade da resposta depende da estrutura do prompt — prompt fixo validado contra dados reais.
