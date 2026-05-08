# Documentação Sentinela

## Architecture
- [Overview](architecture/overview.md) — stack, fluxo de dados, componentes
- [Accumulators](architecture/accumulator.md) — stores em memória (Seq, Kong, Login, WAF, Audit, Infra)
- [Data Model](architecture/data-model.md) — `BucketStore`, `EventStore`, `_ipRollup`
- [Integrations](architecture/integrations.md) — endpoints externos consumidos

## Specs (features de produto)
- [Dashboard](specs/dashboard.md)
- [Logins](specs/login.md) — visão consolidada (Kong + IS4 + Auth Common + WAF correlation)
- [Threat Report](specs/threat-report.md)
- [Audit (Loki)](specs/audit.md)
- [Kubernetes (Grafana)](specs/kubernetes.md)

## Deploy
- [Kubernetes](deploy/kubernetes.md) — pipeline ADO, Kong, manifest, Keel

## Decisões arquiteturais
- [ADR index](adr/) — ADRs históricos (decisões e contexto)
