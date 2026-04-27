# Deploy em Kubernetes

## Cluster alvo

- **Cluster:** `cluster-bra-prd`
- **Namespace:** `integra-prd`
- **URL pública:** `https://crm.ituran.sp/sentinela`
- **Basepath:** `/sentinela` (configurado em `vite.config.ts` e `createRouter`)

## Fluxo de deploy

```
commit em master (github.com/ituran-bra/Sentinela)
  → Azure DevOps pipeline/app/integra/sentinela.yml
    → Docker build (node:24-alpine, multi-stage, non-root)
    → Push: ituran.azurecr.io/integra/sentinela:<BuildId>
    → Bump tag em pipeline/k8s/cluster-bra-prd/integra-prd/apps/sentinela.yml
      → pipeline/k8s/cluster-bra-prd.yml (kubectl apply)
        → Rolling update (maxSurge: 0, maxUnavailable: 1)
```

## Manifesto (resumo)

Arquivo único em `pipeline/k8s/cluster-bra-prd/integra-prd/apps/sentinela.yml`:

| Recurso | Configuração relevante |
|---------|----------------------|
| ConfigMap `sentinela-config` | `PORT=3000`, `SEQ_URL`, `DD_SITE`, `GRAFANA_URL`, etc. |
| Secret `sentinela-secrets` | `azure-openai-api-key`, `grafana-token`, `dd-api-key`, etc. |
| Deployment `sentinela` | `replicas: 1`, `image: ituran.azurecr.io/integra/sentinela:vX.Y.Z` |
| Service `sentinela` | `ClusterIP`, porta 80 → containerPort 3000 |
| Ingress `sentinela-ingress` | `host: crm.ituran.sp`, `path: /sentinela`, `pathType: Prefix` |

## Recursos do container

```yaml
resources:
  requests: { memory: "256Mi", cpu: "100m" }
  limits:   { memory: "768Mi", cpu: "1" }
```

## Probes

Todas apontam para `/sentinela/api/health` (basepath obrigatório):

| Probe | periodSeconds | failureThreshold |
|-------|--------------|-----------------|
| startupProbe | 5 | 30 (tolera ~150s de catch-up) |
| readinessProbe | 3 | 3 |
| livenessProbe | 30 | 3 |

## Secrets — aplicar antes do primeiro deploy

Substituir os `REPLACE_ME` com valores reais. Duas opções:

- **Opção 1:** `echo -n "valor" | base64 -w 0` → trocar `stringData` por `data` e commitar no
  repo `pipeline` (padrão Ituran, seguido por `itulink.yml`/`seq.yml`).
- **Opção 2:** `kubectl apply` manual do Secret fora do Git; remover bloco `Secret` do manifesto.

## Pré-requisitos do cluster

- [ ] Secret `sentinela-secrets` aplicado
- [ ] Egress para todos os endpoints externos (ver `docs/architecture/integrations.md`)
- [ ] Deployment `sentinela` configurado no Azure Foundry (`iturin-ai-eastus2`)
- [ ] `GRAFANA_TOKEN` provisionado com acesso de leitura aos datasources `prometheus` e Loki

## Rollback

```bash
# Alterar tag da imagem no manifesto para a versão anterior e re-aplicar
kubectl rollout undo deployment/sentinela -n integra-prd
```
