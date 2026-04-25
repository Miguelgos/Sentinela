# ADR-009: Desabilitação da verificação de certificado SSL

**Status:** Aceito (com ressalva)  
**Data:** 2026-04-24  
**Contexto:** Seq Analyzer — conexão HTTPS com o Seq de produção

---

## Contexto

O Seq em `https://seq-prd.ituran.sp` usa um certificado SSL autoassinado ou emitido por uma CA interna da Ituran. O Node.js por padrão rejeita certificados não confiáveis:

```
Error: self-signed certificate
```

## Decisão

Desabilitar a verificação de certificado para as requisições HTTP ao Seq:

```typescript
const options: https.RequestOptions = {
  rejectUnauthorized: false,  // certificado autoassinado interno
  ...
};
```

## Justificativa

- O Seq é um servidor **interno** da rede Ituran — não há risco de MITM em rede corporativa controlada
- Adicionar a CA interna ao trust store do Node seria mais correto mas requeria acesso ao certificado raiz da Ituran e configuração do ambiente
- Esta é uma ferramenta interna de desenvolvimento/análise — o risco é aceitável

## Ressalva

Em ambiente de produção mais formal, a solução correta é:

```bash
NODE_EXTRA_CA_CERTS=/path/to/ituran-root-ca.crt node dist/index.js
```

Ou configurar o certificado via `ca` nas opções do `https.request`.

## Consequências

- Conexão funciona sem configuração adicional na rede Ituran
- Vulnerável a MITM se a rede não for confiável (não aplicável neste contexto)
- Suprime o aviso de segurança do Node — deve ser documentado para quem mantiver o projeto
