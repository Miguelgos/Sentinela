# ADR-010 — Migração de PostgreSQL para SQLite + Store In-Memory

## Status

Aceito

## Contexto

O projeto originalmente utilizava PostgreSQL 16 via Docker (`docker-compose.yml`) como store primário. Isso tornava o Docker um pré-requisito obrigatório, exigia a inicialização do serviço antes de qualquer execução e adicionava complexidade operacional desnecessária para um dashboard que serve um único usuário. A carga de consultas do dashboard é inteiramente de leitura sobre uma janela deslizante de 4 a 24 horas, de modo que as garantias de durabilidade relacional do PostgreSQL estavam superdimensionadas para o caso de uso.

## Decisão

- PostgreSQL foi substituído por uma arquitetura de duas camadas: **Map in-memory** (`accumulator.ts`) como superfície primária de consulta e **SQLite** (`better-sqlite3`, `db/sqlite.ts`) como camada de persistência write-through.
- O Map in-memory mantém todos os eventos dentro da janela de retenção configurada, ordenados por timestamp decrescente e indexados por `event_id`.
- O SQLite persiste eventos com **retenção em camadas**: Tier A (eventos Error/Critical/segurança) = 90 dias; Tier B (todos os demais) = 7 dias.
- `accumulator.ts` inicializa carregando todas as linhas SQLite qualificadas para memória na inicialização e, em seguida, executa polling incremental no Seq a cada 60 segundos.
- Todas as consultas de `routes/events.ts` operam sobre o Map in-memory (filtro/ordenação puro em JS), eliminando a sobrecarga de consultas SQL.
- O Docker não é mais necessário para executar o projeto.
- Arquivos removidos: `db/index.ts`, `db/schema.sql`, `sync-core.ts`, `autosync.ts`, `routes/sync.ts`, `routes/autosync.ts`.

## Consequências

- (+) Zero dependências externas para o banco de dados — `npm run dev` é suficiente.
- (+) Tempos de consulta sub-milissegundo para todas as rotas de estatísticas (sem sobrecarga de SQL em uma janela de 4 horas).
- (+) A retenção em camadas permite manter eventos críticos por mais tempo sem saturar a memória.
- (-) A memória cresce com o volume de eventos — mitigado pelo filtro de ruído (`shouldStore()` descarta fontes de alto volume e baixo valor).
- (-) O SQLite é single-writer — aceitável, pois apenas `accumulator.ts` realiza escritas.
- (-) Sem acesso concorrente multi-processo — aceitável para implantação de instância única.
