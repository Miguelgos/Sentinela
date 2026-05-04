# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine AS runtime

RUN apk add --no-cache tini && \
    addgroup -S -g 1001 sentinela && \
    adduser  -S -u 1001 -G sentinela sentinela

WORKDIR /app

COPY --from=build      --chown=sentinela:sentinela /app/dist            ./dist
COPY --from=prod-deps  --chown=sentinela:sentinela /app/node_modules    ./node_modules
COPY --from=build      --chown=sentinela:sentinela /app/package.json    ./package.json
COPY --from=build      --chown=sentinela:sentinela /app/node-server.mjs ./node-server.mjs

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--enable-source-maps"

USER sentinela
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "node-server.mjs"]
