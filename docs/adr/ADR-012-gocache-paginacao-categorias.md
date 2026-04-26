# ADR-012 — GoCache: Paginação Multi-Página e Categorização de Ataques

## Status

Aceito

## Contexto

A integração original com o GoCache buscava apenas os primeiros 100 eventos por tipo (limite da API por requisição). Em dias com volume elevado de ataques, isso truncava o conjunto de dados, tornando a análise de IPs mais frequentes e tipos de ataque não confiável. Além disso, todos os eventos WAF eram exibidos como IDs de alerta brutos, sem agrupamento semântico.

## Decisão

- Implementada a função `fetchAllGcEvents(types, actions, from, to, maxPages)` em `gocache.ts` que:
  1. Busca a página 1 e lê `response.pages` (total de páginas) e `response.total` (total real de eventos).
  2. Busca em paralelo as páginas restantes até o limite de `maxPages` (5 para WAF = 500 eventos, 3 para bot = 300 eventos).
  3. Utiliza o campo `page` no corpo do POST (padrão de paginação do GoCache).
- Implementada a função `classifyAlert(msg, id)` mapeando mensagens de alerta e IDs de regras OWASP para categorias semânticas: SQLi, XSS, PathTraversal, Scanner, Protocol, Other.
- Implementada a função `detectTool(ua)` mapeando strings de User-Agent para ferramentas ofensivas conhecidas: SQLMap, Nikto, Dart, Python, curl, Go, Java, Headless.
- A resposta de `/api/gocache/overview` foi expandida para incluir: `totals` (contagens reais da API), `timeline` (WAF/bot/firewall por hora), `byCountry`, `attackCategories`, `botTypes`, `userAgentTools`, `byMethod`.
- A rota de relatório (`report.ts`) replica `classifyAlert` e `detectTool` inline para evitar importações entre rotas — duplicação aceitável dado o tamanho reduzido das funções.

## Consequências

- (+) Os gráficos de IPs mais frequentes e categorias de ataque agora refletem o volume real de ataques, e não uma amostra de 100 eventos.
- (+) O gráfico `attackCategories` fornece imediatamente a distribuição entre SQLi, XSS e Scanner.
- (+) A regra de ameaça `SCANNER_DETECTED` em `report.ts` depende dessa detecção de ferramentas.
- (-) A paginação em paralelo aumenta o número de chamadas à API do GoCache por requisição (até 8 por chamada a `/overview`).
- (-) O limite `maxPages` restringe o total de eventos — troca deliberada entre completude e tempo de resposta.
