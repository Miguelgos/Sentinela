# ADR-003: Paginação de eventos via cursor afterId

**Status:** Aceito  
**Data:** 2026-04-24  
**Contexto:** Seq Analyzer — como buscar mais de 1000 eventos por sync

---

## Contexto

O Seq limita cada resposta a 1000 eventos (`count=1000`). Para sincronizar períodos mais longos ou capturar todos os eventos disponíveis no buffer, é necessário paginar.

O Seq **não usa paginação por offset** — usa um cursor baseado no ID do evento. Os eventos são retornados do mais novo para o mais antigo.

## Comportamento do Seq

- `GET /api/events/?count=1000` — retorna os 1000 mais recentes
- `GET /api/events/?count=1000&afterId=event-xyz` — retorna os 1000 anteriores ao evento `event-xyz` (mais antigos)
- Uma página com menos de 1000 eventos indica que chegou ao fim

## Decisão

Loop de paginação usando `afterId` igual ao `Id` do **último evento da página** (o mais antigo):

```typescript
while (totalFetched < maxTotal) {
  const url = buildUrl(baseUrl, ..., afterId);
  const { data } = await httpsGetJson(url, headers);
  
  const events = data.map(parseSeqApiEvent);
  if (events.length === 0) break;
  
  await upsertEvents(events);
  totalFetched += events.length;
  
  if (events.length < PAGE_SIZE) break;  // última página
  afterId = events[events.length - 1].event_id;  // cursor para próxima
}
```

## Justificativa

- Mecanismo nativo do Seq — não há offset disponível
- O `event_id` do último item da página funciona como cursor para a página seguinte
- Eventos com menos de `PAGE_SIZE` itens indicam fim da série disponível
- O limite `maxTotal` evita loops infinitos e controla o custo computacional

## Consequências

- A ordem de inserção no banco é do mais novo para o mais antigo — sem impacto nas queries (todas ordenam por `timestamp`)
- Se um evento for removido do Seq entre duas páginas, pode haver lacuna — aceitável para análise histórica
- Eventos muito antigos (além da retenção do Seq) simplesmente não estarão disponíveis — motivação para o auto-sync contínuo (ver ADR-006)

## Limitação de retenção do Seq

Na prática, o signal `signal-m33301` (apenas erros) tem ~48 eventos no buffer do Seq. O Seq descarta eventos antigos conforme novos chegam. Para capturar o fluxo completo de erros, o auto-sync a cada 60s é essencial.
