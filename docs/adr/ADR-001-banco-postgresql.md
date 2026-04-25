# ADR-001: PostgreSQL como banco de dados principal

**Status:** Aceito  
**Data:** 2026-04-24  
**Contexto:** Seq Analyzer — escolha do banco de dados

---

## Contexto

O projeto precisa persistir eventos de log com as seguintes características:

- Eventos chegam em lotes (até 1000 por requisição ao Seq)
- Campos estruturados para filtragem rápida (level, user_id, guid_cotacao, timestamp)
- Campo semi-estruturado (`raw_data`) para armazenar o evento completo
- Consultas analíticas (GROUP BY, COUNT, timeline por hora)
- Upsert por `event_id` para evitar duplicatas
- Ambiente de desenvolvimento local (Docker)

## Opções consideradas

| Opção | Prós | Contras |
|-------|------|---------|
| **PostgreSQL** | JSONB nativo com GIN index, SQL completo, upsert (`ON CONFLICT`), excelente performance analítica, imagem Docker oficial | Requer schema prévio |
| SQLite | Zero configuração, arquivo local | Sem JSONB, concorrência limitada, sem GIN index |
| MongoDB | Schema-less, BSON nativo | Sem SQL analítico nativo, JOIN com SQL Server mais complexo |
| TimescaleDB | Otimizado para séries temporais | Overhead adicional, superdimensionado para o volume |

## Decisão

**PostgreSQL 16-alpine via Docker** na porta `5434` (porta `5432` estava ocupada no host).

## Justificativa

1. **JSONB + GIN index** — permite armazenar o evento completo sem schema fixo, com busca eficiente por campos do JSON quando necessário
2. **`ON CONFLICT DO NOTHING`** — upsert nativo por `event_id` sem lógica adicional de deduplicação
3. **SQL analítico** — `GROUP BY`, `date_trunc`, `COUNT(DISTINCT)`, `regexp_match` — tudo disponível nativamente para as queries de estatísticas
4. **Índices parciais** — índices em `timestamp`, `level`, `guid_cotacao`, `user_id` cobrem os filtros mais comuns
5. **Maturidade** — stack conhecida, imagem Docker oficial, biblioteca `pg` robusta para Node.js

## Consequências

- Necessário definir schema SQL inicial (`schema.sql` montado como init script no Docker)
- Migrações futuras requerem ALTER TABLE ou scripts adicionais
- Porta 5434 (não padrão) deve ser configurada via variável de ambiente `DATABASE_URL`
