# Spec — Dashboard

**Rota interna:** `dashboard`
**Componente:** `Dashboard.tsx`
**Endpoint:** `GET /api/events/stats/summary`
**PDF:** `exportDashboardPdf`

## Requisito funcional (RF-05)

### Cards de totais (últimas 4h)

- Total de eventos
- Total de erros
- Eventos com GUID de cotação vazio
- Falhas de autenticação
- Usuários afetados (únicos)

### Distribuição por nível

Gráfico de barras: Error / Warning / Information / outros.

### Top erros por mensagem

Ranking das mensagens de erro mais frequentes com contagem.

### Top usuários por volume

Ranking de `user_id` com lookup de `nm_pessoa` via SQL Server.

### Top serviços

Ranking de `dd_service` por volume de eventos.

### Breakdown GUID cotação

Proporção de eventos com GUID vazio vs. GUID válido.

### Timeline (últimas 24h)

Gráfico de linha/área por hora e nível de log.

## Exportação PDF

Botão "Exportar PDF" no canto superior direito.

Cabeçalho: barra azul + logo Sentinela (`sentinela_v1_radar_pulso.svg` rasterizado) + título.
Rodapé: paginação.
Arquivo: `dashboard-{yyyy-MM-dd_HH-mm}.pdf`.

## Requisitos não-funcionais

| Requisito | Valor |
|-----------|-------|
| Janela de stats | Últimas 4h (`STATS_WINDOW`) |
| Latência alvo | < 2s (store in-memory) |
| Volume esperado | Até ~500 eventos/hora |
