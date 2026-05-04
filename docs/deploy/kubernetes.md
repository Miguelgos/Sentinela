# Deploy — Kubernetes (`integra-prd` em `cluster-bra-prd`)

URL pública: <https://crm.ituran.sp/sentinela>

## Pipeline (Azure DevOps)

| | |
|---|---|
| Pipeline | `sentinela` (id 630, folder `\app\utils`) |
| YAML | `pipeline/app/integra/sentinela.yml` no repo `TI/pipeline` |
| Trigger | push em `main` do GitHub `ituran-bra/Sentinela` |
| Service Connection | `github.com_ituran-bra` (GitHub App) |
| Output | `ituran.azurecr.io/integra/sentinela:1.0.<BuildId>` + `:latest` |

Build standalone — não usa `_templates/pipeline-build-images.yml`. Webhook do GitHub é registrado depois do 1º run manual.

## Imagem

Multi-stage com pnpm e `node-linker=hoisted` (sem isso o `COPY` cross-stage do `node_modules` leva 100+ s por causa dos hardlinks).

```
deps      (pnpm install --frozen-lockfile)
  → build (vite build → dist/)
  → prod-deps (pnpm install --prod)
  → runtime (Node 24 alpine, tini, non-root, copia dist + prod node_modules + node-server.mjs)
```

CMD: `node node-server.mjs`. Expõe `:3000`.

## Kong (gateway)

Não há Ingress — Kong em DBless mode tem rota declarativa em `pipeline/k8s/cluster-bra-prd/2-routes.yml`:

```yaml
- url: http://sentinela.integra-prd:80/
  routes:
  - regex_priority: 0
    hosts:
    - crm.ituran.sp
    paths:
    - ~/(?i)sentinela
    strip_path: false   # app tem basepath /sentinela no router
  retries: 0
```

Na frente do Kong tem F5 BigIP (cookie `BIGipServerPOOL_INTEGRA-NOVA`).

## Manifesto (`apps/sentinela.yml`)

| Recurso | Detalhe |
|---|---|
| `ConfigMap sentinela-config` | `PORT`, `SEQ_URL`, `DD_SITE`, `GRAFANA_URL`, `LOKI_AUDIT_UID`, `AZURE_OPENAI_*` |
| `Secret sentinela-secrets` | `AZURE_OPENAI_KEY`, `DD_API_KEY`, `DD_APP_KEY`, `GC_TOKEN`, `GRAFANA_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `Deployment sentinela` | `replicas: 1`, label `app: sentinela` (Promtail), Datadog tags, Keel auto-pull tag `latest` |
| `Service sentinela` | ClusterIP `:80 → :3000` |

`envFrom` traz **`appsettings-prd`** (ConfigMap compartilhado) — isso entrega `ConnectionStrings__ITURANWEB` para o lookup MSSQL sem credencial duplicada.

## Recursos do pod

```yaml
requests:  { memory: "256Mi", cpu: "100m" }
limits:    { memory: "768Mi", cpu: "1" }
```

## Probes (todas em `/sentinela/api/health`)

| | period | failure |
|---|---|---|
| startup | 5 s | 30 (~150 s) |
| readiness | 3 s | 3 |
| liveness | 30 s | 3 |

## Keel (deploy automático)

```yaml
keel.sh/policy: force
keel.sh/match-tag: "true"
keel.sh/pollSchedule: '@every 30s'
keel.sh/trigger: poll
```

Pipeline empurra `:latest` no ACR → Keel detecta SHA novo em ~30 s → rolling update do pod. Não há bump manual de YAML.

## Promtail/Loki

Captura pods com label `app=<name>` que casa com regex em `promtail-config` (ConfigMap no ns `monitoring`, não versionado no repo `pipeline`). Pra adicionar app, editar regex e `kubectl rollout restart daemonset/promtail -n monitoring`.

## Pré-requisitos pra novo cluster

- Egress liberado para Seq, Datadog, GoCache, Grafana, Azure OpenAI, MSSQL (vide [`integrations.md`](../architecture/integrations.md))
- Deployment `sentinela` no Azure Foundry (`iturin-ai-eastus2`) provisionado pela equipe IA
- `GRAFANA_TOKEN` com leitura nos datasources `prometheus` e `integra-audit` (Loki)
- `sentinela-secrets` aplicado com valores reais antes do 1º apply
- `sentinela` na regex do Promtail

## Runbook rápido

```bash
KUBECONFIG=~/.kube/br-prd kubectl -n integra-prd \
  rollout status deployment/sentinela
KUBECONFIG=~/.kube/br-prd kubectl -n integra-prd \
  logs -l app=sentinela --tail=100
KUBECONFIG=~/.kube/br-prd kubectl -n integra-prd \
  top pod -l app=sentinela
curl -ks https://crm.ituran.sp/sentinela/api/health
```

Forçar rollout (Keel não pegou):

```bash
KUBECONFIG=~/.kube/br-prd kubectl -n integra-prd \
  delete pod -l app=sentinela
```
