# =============================================================================
#  Painel administrativo — imagem de produção
# =============================================================================
#  O build do Vite **não** recebe a URL da API: o front chama `/api` relativo e
#  o nginx resolve o destino em tempo de execução, via envsubst no entrypoint.
#  É o que permite trocar a porta da API sem reconstruir esta imagem.
# =============================================================================

FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json        apps/api/
COPY apps/web/package.json        apps/web/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN pnpm --filter @gateway/shared build \
 && pnpm --filter @gateway/web build

# --- runtime ----------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# gettext traz o envsubst, usado pelo entrypoint para resolver o template.
RUN apk add --no-cache gettext curl

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY docker/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/web/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

ENV WEB_INTERNAL_PORT=80

EXPOSE 80

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${WEB_INTERNAL_PORT}/" >/dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]
