# ADR-006: Auto-sync controlado pelo backend

**Status:** Aceito  
**Data:** 2026-04-24  
**Contexto:** Seq Analyzer — estratégia de sincronização contínua

---

## Contexto

O Seq tem retenção de eventos muito limitada — na prática, o signal `signal-m33301` mantém cerca de 48 eventos no buffer. Novos eventos substituem os antigos continuamente. Para capturar o fluxo completo de erros ao longo do dia, é necessário sincronizar frequentemente.

A implementação inicial usava `setInterval` no **frontend** (browser) para chamar `POST /api/sync` a cada minuto. Isso funciona mas tem limitações:

- Para quando o usuário fecha o navegador
- Estado duplicado (frontend + backend)
- Não persiste entre sessões
- A UI fica travada gerenciando timers

## Decisão

Mover o auto-sync para o **backend**, com estado centralizado em memória e API REST para controle:

```
backend/src/autosync.ts          # módulo com estado (singleton)
backend/src/sync-core.ts         # funções reutilizadas pelo sync manual também
backend/src/routes/autosync.ts   # POST /start, POST /stop, GET /status
```

O auto-sync inicia automaticamente quando o servidor sobe:

```typescript
app.listen(PORT, () => {
  startAutoSync(); // inicia imediatamente
});
```

## Endpoints de controle

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/autosync/start` | Inicia (ou reinicia) com parâmetros opcionais |
| POST | `/api/autosync/stop` | Para o timer |
| GET | `/api/autosync/status` | Retorna estado completo |

## Estado exposto pelo status

```typescript
{
  running: boolean;
  intervalMs: number;      // 60000 por padrão
  seqUrl: string;
  signal: string;
  lastRun: string | null;  // ISO timestamp
  lastImported: number;    // eventos importados na última run
  lastTotal: number;       // eventos recebidos na última run
  totalImported: number;   // acumulado desde o início
  runs: number;            // número de execuções
  error: string | null;    // último erro, se houver
}
```

## Frontend

A UI faz polling do `/api/autosync/status` a cada 5 segundos e exibe o painel de status quando o auto-sync está ativo. O botão de start/stop chama os endpoints REST correspondentes.

## Justificativa

- O sync continua mesmo com o navegador fechado
- Estado único e confiável no servidor
- A UI pode ser aberta em múltiplos contextos sem conflito
- Fácil de estender (ex: configurar intervalo, signal, URL via `POST /start`)

## Consequências

- Estado em memória — reiniciar o servidor para o auto-sync (mas ele reinicia automaticamente no boot)
- Se o servidor cair e não subir automaticamente, o sync para — a configuração deve ser feita via processo de startup (systemd, pm2, etc.)
- O intervalo mínimo atual é hardcoded a 60 segundos — parâmetro aceito via `POST /start { intervalMs }` para ajuste
