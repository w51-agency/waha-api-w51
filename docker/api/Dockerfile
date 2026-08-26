# =============================================================================
#  Gateway API — imagem de produção
# =============================================================================
#  Multi-stage: a imagem final não carrega devDependencies, código-fonte nem
#  toolchain de build.
#
#  A imagem **preserva o layout do monorepo** (/app/apps/api, /app/packages/
#  shared). Não é preferência: o plugin do @nestjs/swagger gera metadados com
#  `require` de caminho **relativo** ao layout de build — algo como
#  `../../../../../../../packages/shared/dist/index`. Achatar a estrutura faz o
#  processo morrer no arranque com MODULE_NOT_FOUND, e o rastro não aponta para
#  o plugin.
# =============================================================================

# --- estágio 1: dependências completas (para compilar) ----------------------
FROM node:22-alpine AS deps

RUN corepack enable
WORKDIR /app

# Só os manifestos primeiro: a camada de dependências só é invalidada quando
# eles mudam, não a cada alteração de código.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json        apps/api/
COPY apps/web/package.json        apps/web/
COPY packages/shared/package.json packages/shared/

# --ignore-scripts: o postinstall roda `prisma generate`, que precisa do schema
# (ainda não copiado). Ele é executado explicitamente no build.
RUN pnpm install --frozen-lockfile --ignore-scripts

# --- estágio 2: build -------------------------------------------------------
FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /app

COPY --from=deps /app/node_modules                 ./node_modules
COPY --from=deps /app/apps/api/node_modules        ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

COPY package.json pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm --filter @gateway/shared build \
 && cd apps/api \
 && pnpm exec prisma generate \
 && pnpm exec nest build

# --- estágio 3: dependências de produção ------------------------------------
FROM node:22-alpine AS prod-deps

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json        apps/api/
COPY apps/web/package.json        apps/web/
COPY packages/shared/package.json packages/shared/

# Sem devDependencies: reduz a imagem e a superfície de vulnerabilidades.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @gateway/api... \
 && pnpm store prune \
 # O pacote shared não tem dependências de produção, então o pnpm não cria o
 # diretório. O COPY do estágio seguinte falharia com "not found".
 && mkdir -p packages/shared/node_modules apps/api/node_modules

# --- estágio 4: runtime -----------------------------------------------------
FROM node:22-alpine AS runtime

# tini encaminha sinais corretamente: sem ele o Node vira PID 1, ignora SIGTERM
# e todo deploy espera o timeout do Docker.
RUN apk add --no-cache tini curl \
 && addgroup -g 1001 gateway \
 && adduser -u 1001 -G gateway -s /bin/sh -D gateway

WORKDIR /app

COPY --from=prod-deps --chown=gateway:gateway /app/node_modules                 ./node_modules
COPY --from=prod-deps --chown=gateway:gateway /app/apps/api/node_modules        ./apps/api/node_modules
COPY --from=prod-deps --chown=gateway:gateway /app/packages/shared/node_modules ./packages/shared/node_modules

COPY --from=build --chown=gateway:gateway /app/packages/shared/dist         ./packages/shared/dist
COPY --from=build --chown=gateway:gateway /app/packages/shared/package.json ./packages/shared/package.json

COPY --from=build --chown=gateway:gateway /app/apps/api/dist             ./apps/api/dist
COPY --from=build --chown=gateway:gateway /app/apps/api/prisma           ./apps/api/prisma
COPY --from=build --chown=gateway:gateway /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build --chown=gateway:gateway /app/apps/api/package.json     ./apps/api/package.json

COPY --chown=gateway:gateway package.json pnpm-workspace.yaml ./

USER gateway

# O processo roda a partir de apps/api: é onde o prisma.config.ts espera estar,
# e é o que faz os caminhos relativos gerados no build resolverem.
WORKDIR /app/apps/api

ENV NODE_ENV=production
ENV API_PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${API_PORT}/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/main.js"]
