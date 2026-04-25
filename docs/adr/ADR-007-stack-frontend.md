# ADR-007: Stack do frontend — React + Vite + Tailwind + shadcn/ui

**Status:** Aceito  
**Data:** 2026-04-24  
**Contexto:** Seq Analyzer — escolha da stack de frontend

---

## Contexto

O projeto precisa de um dashboard web responsivo, com componentes reutilizáveis (cards, tabelas, badges, inputs), gráficos e atualizações de estado. É uma ferramenta interna de uso individual/pequeno time — não precisa de SSR, SEO ou autenticação.

## Decisão

| Camada | Escolha | Alternativa descartada |
|--------|---------|----------------------|
| Framework | React 18 | Vue, Svelte |
| Build | Vite | Create React App, webpack |
| Estilo | Tailwind CSS v3 | CSS Modules, Styled Components |
| Componentes | shadcn/ui (manual) | MUI, Ant Design, Chakra |
| Gráficos | Recharts | Chart.js, Victory |
| HTTP | Axios | fetch nativo |
| Datas | date-fns | dayjs, moment |
| Ícones | Lucide React | Heroicons, Feather |

## Por que shadcn/ui "manual"?

O shadcn/ui normalmente usa um CLI para gerar componentes no projeto. Neste caso, os componentes foram criados manualmente em `src/components/ui/` usando os primitivos do Radix UI diretamente, pelo seguinte motivo:

- A CLI do shadcn/ui não estava disponível no ambiente
- Os componentes usam a mesma base (Radix UI + CVA + tailwind-merge) e são equivalentes
- `@radix-ui/react-badge` não existe como pacote separado — o `Badge` foi implementado com `class-variance-authority` (CVA) puro

## Estrutura de componentes UI

```
src/components/ui/
├── badge.tsx      # CVA com variantes: default, error, warning, info
├── button.tsx     # Radix Slot + CVA
├── card.tsx       # Card + CardHeader + CardContent + CardTitle + CardDescription
├── dialog.tsx     # @radix-ui/react-dialog
├── input.tsx      # input nativo estilizado
├── label.tsx      # @radix-ui/react-label
├── scroll-area.tsx
├── select.tsx     # @radix-ui/react-select
├── separator.tsx  # @radix-ui/react-separator
├── skeleton.tsx   # div animado
├── tabs.tsx       # @radix-ui/react-tabs
└── textarea.tsx
```

## Proxy Vite

O Vite é configurado para fazer proxy de `/api/*` para `http://localhost:3001`, permitindo que o frontend rode em `:5173` sem problemas de CORS:

```typescript
// vite.config.ts
server: {
  proxy: {
    "/api": "http://localhost:3001",
  },
}
```

## Consequências

- Zero dependência de servidores de produção — basta `npm run dev` para desenvolver
- Os componentes UI estão no projeto — sem surpresas de versão de biblioteca
- Recharts funciona bem para as necessidades atuais (área, linha, tooltip); para dashboards mais complexos pode ser necessário ECharts ou D3
