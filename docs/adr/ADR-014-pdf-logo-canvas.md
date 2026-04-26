# ADR-014 — PDF Export: Logo Sentinela Rasterizado via Canvas API

## Status

Aceito

## Contexto

A exportação de PDF original utilizava uma função programática `drawLogo()` que desenhava um escudo/olho com primitivas do jsPDF. Isso era um placeholder — a identidade visual real do Sentinela é um SVG com fundo escuro (`sentinela_v1_radar_pulso.svg`, 800x320px) com um gráfico de radar/pulso. Incorporar esse SVG diretamente não era viável: o jsPDF não renderiza SVG nativamente, e o fundo escuro conflitaria com o cabeçalho azul do PDF.

## Decisão

- O SVG customizado (`sentinela_v1_radar_pulso.svg`) é servido como asset estático a partir de `frontend/public/`.
- `exportPdf.ts` pré-carrega o logo no momento da importação do módulo:
  1. `fetch('/sentinela_v1_radar_pulso.svg')` retorna o texto do SVG.
  2. Cria um `Blob` com tipo MIME `image/svg+xml`.
  3. `URL.createObjectURL(blob)` gera uma URL temporária de blob.
  4. Carrega em um `Image` e aguarda o evento `onload`.
  5. Desenha em um `<canvas>` de 800x320 via `ctx.drawImage()`.
  6. Extrai como PNG via `canvas.toDataURL('image/png')`, armazenado em `_logoDataUrl`.
  7. Revoga a URL do blob.
- A função `header()` em `exportPdf.ts` utiliza `_logoDataUrl` quando disponível e recorre ao `drawLogo()` programático como fallback caso o pré-carregamento ainda não tenha sido concluído (por exemplo, no primeiro render).
- O componente React `SentinelaLogo` (`SentinelaLogo.tsx`) renderiza o mesmo SVG via `<img>` na barra lateral.
- Uma nova função de exportação `exportThreatReportPdf(report)` foi adicionada para o relatório de ameaças, seguindo o mesmo padrão de cabeçalho/rodapé/seção das exportações existentes. Inclui: caixa de resumo de risco, tabela de status das fontes, tabela de visão geral dos achados (linhas coloridas por risco), tabelas de evidências por achado e a narrativa do Gemini com parsing de markdown.

## Consequências

- (+) Todos os PDFs agora utilizam o logo real da marca de forma consistente.
- (+) O pré-carregamento na importação do módulo garante que o PNG esteja pronto antes que o usuário clique em qualquer botão de exportação.
- (+) O fallback para `drawLogo()` garante que os PDFs ainda funcionem caso o fetch do SVG falhe.
- (-) A rasterização via canvas produz um PNG com fundo escuro — aceitável, pois a área do cabeçalho acomoda o contraste suficiente.
- (-) A Canvas API requer ambiente de browser — não é possível gerar PDFs no lado do servidor com essa abordagem. Aceitável, pois todas as exportações são client-side.
