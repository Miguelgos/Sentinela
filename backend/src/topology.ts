// Mapa estático de dependências entre serviços do ecossistema Ituran. Replica
// (de forma simplificada) o que o Smartscape do Dynatrace faz automaticamente.
// Quando 2 services anômalos têm relação no grafo, viram 1 problema com causa
// raiz inferida (o mais a montante na cadeia).
//
// Atualizar quando arquitetura mudar. Mapa vazio = correlateProblems funciona
// como antes (apenas dedup por fonte+tempo).

// Cada chave depende dos serviços listados (upstream/downstream).
export const SERVICE_DEPENDENCIES: Record<string, string[]> = {
  salesbo:      ["identity"],
  customer360:  ["integra"],
  fieldservice: ["integra"],
  integra:      ["identity"],
};

// Computa transitivamente todos os ancestrais (upstream) de um service.
// salesbo → identity (direto)
// customer360 → integra → identity (transitivo)
export function upstreamOf(service: string): Set<string> {
  const visited = new Set<string>();
  const stack = [...(SERVICE_DEPENDENCIES[service] ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (visited.has(next)) continue;
    visited.add(next);
    for (const dep of SERVICE_DEPENDENCIES[next] ?? []) stack.push(dep);
  }
  return visited;
}

// Verifica se dois serviços têm relação direta ou transitiva no grafo (em
// qualquer direção — A upstream de B, ou B upstream de A).
export function areRelated(serviceA: string, serviceB: string): boolean {
  if (serviceA === serviceB) return true;
  if (upstreamOf(serviceA).has(serviceB)) return true;
  if (upstreamOf(serviceB).has(serviceA)) return true;
  return false;
}

// Dado um conjunto de serviços, retorna o "mais upstream" (o que tem mais
// dependentes dentre o set, equivalente ao "root cause" provável).
export function rootCauseService(services: string[]): string | null {
  if (services.length === 0) return null;
  if (services.length === 1) return services[0];

  // Para cada candidato, conta quantos OUTROS estão downstream dele.
  // Mais downstreams = mais provável ser causa raiz.
  let best = services[0];
  let bestScore = -1;
  for (const candidate of services) {
    let score = 0;
    for (const other of services) {
      if (other === candidate) continue;
      if (upstreamOf(other).has(candidate)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
