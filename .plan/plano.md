# WhatsApp Gateway W51 — Plano de Desenvolvimento

## Contexto

O diretório `/media/lucascaleto/arquivos2/waha-api-w51` está vazio (só `.plan/start.md` e `tasks/`). O objetivo, conforme `.plan/start.md`, é construir do zero um **gateway multi-sistema de WhatsApp** rodando em Docker, que:

1. Conecta ao WhatsApp via **WAHA no motor NOWEB** (WebSocket/Baileys — sem Chromium, baixo consumo de memória).
2. Expõe uma **API própria documentada em Swagger** para outros sistemas consumirem.
3. Emite **API keys por sistema integrador**, registrando qual sistema pediu cada QR code e a qual número aquele QR resultou.
4. Oferece um **painel** com números conectados, mensagens trafegadas, métricas e auditoria.

O sistema **não é** um fork do WAHA: é uma camada de gateway/multi-tenancy na frente dele. O WAHA fica em rede interna, sem exposição pública; todo acesso externo passa pelo nosso gateway, que autentica, autoriza, registra e repassa.

### Achados da pesquisa que moldam o desenho

- **Motor NOWEB** é o correto para "não usar browser": `WHATSAPP_DEFAULT_ENGINE=NOWEB`. Exige `config.noweb.store.enabled = true` para ter acesso a chats/contatos/mensagens. Não suporta screenshot (irrelevante aqui).
- **Desde a versão 2026.6.1 o WAHA é 100% gratuito e open source** — a divisão Core/Plus acabou. Mídia, sessões ilimitadas, storages e segurança já vêm na imagem `devlikeapro/waha`. Não há licença a comprar nem imagem `waha-plus` a configurar.
- **`config.metadata` da sessão aceita chaves arbitrárias e volta em todo webhook.** É a peça central do rastreio: carimbamos `application.id` / `gateway.session.id` na criação e todo evento chega já identificado, sem precisar de tabela de correlação frágil.
- **Persistência de sessão em Postgres** via `WHATSAPP_SESSIONS_POSTGRESQL_URL` — melhor que volume em disco para deploy/backup.
- Webhooks do WAHA são assinados com **HMAC-SHA512** do corpo bruto (`X-Webhook-Hmac`, `X-Webhook-Hmac-Algorithm`, `X-Webhook-Request-Id`, `X-Webhook-Timestamp`) e o envelope traz `id` (idempotência), `event`, `session`, `metadata`, `me`, `payload`, `engine`.
- Status de sessão: `STOPPED`, `STARTING`, `SCAN_QR_CODE`, `PASSKEY_REQUIRED`, `PASSKEY_CONFIRMATION_REQUIRED`, `WORKING`, `FAILED`.

### Decisões confirmadas com o usuário

| Tema | Decisão |
|---|---|
| Stack | NestJS + Prisma + Postgres (API) / React + Vite + Tailwind (painel), monorepo pnpm |
| Escopo | Envio de mídia, webhooks de saída, histórico de mensagens recebidas, métricas e gráficos |
| Isolamento | Cada API key enxerga e usa **apenas as sessões da própria aplicação**; o painel admin vê tudo |
| Painel | Usuário único vindo do `.env` (sem CRUD de usuários), JWT + refresh |

Convenção: **código e identificadores em inglês; documentação, UI e mensagens de erro voltadas ao usuário em PT-BR.**

---

## Arquitetura

```
                    ┌──────────────────────────────────────────┐
Sistema externo ──▶ │  Gateway API (NestJS)  :3001             │
  X-API-Key         │  /v1/*      API pública (API key)        │
                    │  /admin/*   painel (JWT)                 │
                    │  /docs      Swagger UI + openapi.json    │
                    │  /internal/waha/webhook  (HMAC-SHA512)   │
                    └───┬───────────────┬──────────────┬───────┘
                        │               │              │
                   ┌────▼────┐    ┌─────▼─────┐   ┌────▼─────┐
                   │ Postgres│    │   Redis   │   │   WAHA   │ :3000
                   │ gateway │    │  BullMQ   │   │  NOWEB   │ (rede interna)
                   │  waha   │    └───────────┘   └──────────┘
                   └─────────┘
                        ▲
                   ┌────┴─────────────────┐
                   │ Painel React (nginx) │ :8080  → proxy /api → gateway
                   └──────────────────────┘
```

Layout do repositório:

```
waha-api-w51/
├─ apps/
│  ├─ api/          NestJS + Prisma + Swagger
│  └─ web/          React + Vite + Tailwind + shadcn/ui
├─ packages/
│  └─ shared/       tipos, enums e client TS gerado do OpenAPI
├─ docker/          Dockerfiles, nginx.conf, entrypoints
├─ docs/            guia de integração, runbook, ADRs
├─ tasks/           tarefas numeradas com checklist (fonte de verdade da execução)
├─ docker-compose.yml         (dev)
├─ docker-compose.prod.yml    (produção)
└─ .env.example
```

### Configuração: `.env` como fonte única, todas as portas trocáveis

**Nenhuma porta é fixa em `docker-compose.yml`, Dockerfile, nginx.conf ou código.** Todo mapeamento usa interpolação com default (`"${API_PORT:-3001}:${API_PORT:-3001}"`), de modo que trocar uma linha do `.env` e rodar `docker compose up -d` já reflete a mudança — inclusive quando a porta desejada é a mesma dentro e fora do container.

`.env.example` (comentado, com defaults) traz no mínimo:

```bash
# ── Portas expostas no host (mude à vontade se houver conflito) ──
WEB_PORT=8080          # painel (nginx)
API_PORT=3001          # gateway NestJS
POSTGRES_PORT=5432     # Postgres
REDIS_PORT=6379        # Redis
WAHA_PORT=3000         # WAHA — em produção NÃO é publicado (ver docker-compose.prod.yml)

# ── Bind do host: 127.0.0.1 mantém o serviço só local; 0.0.0.0 expõe na rede ──
BIND_ADDRESS=127.0.0.1

# ── Postgres ──
POSTGRES_USER=gateway
POSTGRES_PASSWORD=troque-me
POSTGRES_DB=gateway
WAHA_POSTGRES_DB=waha

# ── URLs internas (usam o nome do serviço na rede docker, não localhost) ──
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
REDIS_URL=redis://redis:6379
WAHA_BASE_URL=http://waha:3000
GATEWAY_INTERNAL_URL=http://api:${API_PORT}   # usado no webhook que o WAHA chama de volta

# ── Painel ──
ADMIN_USERNAME=admin
ADMIN_PASSWORD=troque-me
JWT_SECRET=
JWT_REFRESH_SECRET=

# ── Segredos ──
WAHA_API_KEY=            # gateway → WAHA
WAHA_WEBHOOK_HMAC_KEY=   # WAHA → gateway
API_KEY_PREFIX=wgw_live

# ── WAHA ──
WHATSAPP_DEFAULT_ENGINE=NOWEB
WHATSAPP_RESTART_ALL_SESSIONS=true
WAHA_DASHBOARD_ENABLED=false     # nosso painel substitui
WHATSAPP_SWAGGER_ENABLED=false
WAHA_LOG_FORMAT=JSON
TZ=America/Sao_Paulo
```

Dois detalhes que costumam morder e ficam resolvidos por desenho:

- **Portas internas ≠ portas do host.** Postgres, Redis e WAHA são acessados pelos outros containers sempre em `postgres:5432`, `redis:6379`, `waha:3000` (nome do serviço + porta interna, que não muda). As variáveis `*_PORT` controlam **só o lado do host**, então trocar `POSTGRES_PORT=5544` não quebra nada internamente. O gateway é a exceção: escuta em `${API_PORT}` de verdade, e o `GATEWAY_INTERNAL_URL` acompanha.
- **Painel → API.** O build do Vite não pode congelar a URL da API. O nginx do painel faz proxy de `/api` para `${API_HOST}:${API_PORT}` via template (`envsubst` no entrypoint), e o front chama sempre `/api` relativo. Trocar `API_PORT` não exige rebuild da imagem do painel.

Uma tarefa de verificação fecha o assunto: subir tudo com portas não-default (`WEB_PORT=9090 API_PORT=4001 POSTGRES_PORT=5544 REDIS_PORT=6399`) e confirmar o fluxo ponta a ponta funcionando.

### Modelo de dados (Prisma / schema `gateway`)

- **Application** — o sistema integrador. `id, name, slug (unique), description, active, timestamps`.
- **ApiKey** — `id, applicationId, name, prefix (unique, indexado), hash (argon2id), scopes[], lastUsedAt, expiresAt, revokedAt`. Formato da chave: `wgw_{env}_{prefix8}_{secret32}`; só o hash é persistido e o segredo aparece **uma única vez** na criação.
- **Session** — `id, applicationId, name (nome no WAHA, unique), label, status, engine, phoneNumber, waId, pushName, qrRequestCount, lastQrRequestedAt, connectedAt, disconnectedAt, lastStatusAt, createdByApiKeyId, createdVia (API|DASHBOARD), meta`.
- **Message** — `id, applicationId, sessionId, wahaId, direction (INBOUND|OUTBOUND), chatId, fromMe, type, body, mediaUrl, mediaMimeType, ack, status (QUEUED|SENT|FAILED), error, sentByApiKeyId, timestamp, raw`. Únicos/índices: `@@unique([sessionId, wahaId])`, `@@index([applicationId, timestamp])`.
- **WebhookEndpoint** — `id, applicationId, url, secret, events[], active, description`.
- **WebhookDelivery** — `id, endpointId, eventId, eventType, payload, attempts, status, responseStatus, responseBody, nextRetryAt, deliveredAt`.
- **InboundEvent** — `wahaEventId (unique)` para idempotência da ingestão.
- **AuditLog** — `actorType (ADMIN|API_KEY|SYSTEM), actorId, action, resourceType, resourceId, ip, userAgent, metadata`.

O WAHA usa **database separado** (`waha`) no mesmo Postgres, via `WHATSAPP_SESSIONS_POSTGRESQL_URL` — sem colisão com o schema do gateway.

### O fluxo central: QR rastreado ponta a ponta

1. Sistema chama `POST /v1/sessions` com sua API key → gateway resolve a `Application`, gera nome único `{slug}--{nanoid}`, cria a `Session` local e chama `POST {waha}/api/sessions` com:
   ```json
   { "name": "crm--k3n9x2", "start": true, "config": {
       "metadata": { "application.id": "...", "application.slug": "crm",
                     "gateway.session.id": "...", "created.by.apikey": "..." },
       "noweb": { "store": { "enabled": true, "fullSync": false } },
       "webhooks": [{ "url": "http://api:3001/internal/waha/webhook",
                      "events": ["*"], "hmac": { "key": "<segredo>" },
                      "retries": { "policy": "exponential", "delaySeconds": 2, "attempts": 15 } }]
   }}
   ```
2. Sistema chama `GET /v1/sessions/{id}/qr` → gateway valida ownership, **incrementa `qrRequestCount`, grava `lastQrRequestedAt` e um `AuditLog`**, e proxeia `GET {waha}/api/{name}/auth/qr`.
3. Usuário escaneia → WAHA dispara `session.status = WORKING` com `me.id` e o `metadata` carimbado → o ingestor grava `phoneNumber`, `waId`, `pushName`, `connectedAt`. **É aqui que o vínculo sistema ↔ número se fecha, com trilha completa de qual chave pediu o QR e quando.**
4. Painel acompanha em tempo real por SSE (`/admin/events`).

### Superfície da API pública (`/v1`, header `X-API-Key`)

- **Sessões**: `POST /sessions`, `GET /sessions`, `GET /sessions/{id}`, `GET /sessions/{id}/qr`, `POST /sessions/{id}/pairing-code`, `POST /sessions/{id}/{start|stop|restart|logout}`, `DELETE /sessions/{id}`
- **Envio**: `POST /messages/{text|image|file|voice|video|location|contact|reaction|seen|typing}`
- **Consulta**: `GET /messages` (filtros por sessão, chat, direção, período, paginação por cursor), `GET /messages/{id}`, `GET /sessions/{id}/chats`, `GET /sessions/{id}/chats/{chatId}/messages`, `GET /contacts/check-exists`, `GET /media/{id}` (proxy autenticado — o WAHA nunca é exposto)
- **Webhooks do integrador**: CRUD `/webhook-endpoints`, `GET /webhook-endpoints/{id}/deliveries`, `POST /webhook-endpoints/{id}/test`
- **Meta**: `GET /me`, `GET /health`, `GET /health/ready`

Toda operação passa por um `ApplicationScopeGuard` que garante que a sessão alvo pertence à aplicação da chave — respondendo `404` (não `403`) para não vazar existência de sessões alheias.

### Segurança

- API key validada por lookup no `prefix` + verificação argon2id do segredo, com cache LRU de 60s para não pagar argon2 por requisição.
- Rate limit por API key (`@nestjs/throttler` com storage Redis).
- Helmet, CORS por allowlist, limite de corpo, validação estrita (`whitelist: true, forbidNonWhitelisted: true`).
- Entrada de webhook do WAHA: verificação HMAC-SHA512 sobre o **corpo bruto** (exige `rawBody: true` no Nest), janela de timestamp e idempotência por `event.id`.
- Saída de webhook para o integrador: assinatura própria `X-Gateway-Signature: t=<ts>,v1=<hmac-sha256>` no estilo Stripe, com segredo por endpoint.
- Segredos nunca em log; redaction no logger (pino) para `authorization`, `x-api-key`, `password`, `secret`, `hash`.

---

## Tarefas

Cada item vira um arquivo `tasks/NN-nome.md` com objetivo, contexto, checklist detalhado e critérios de aceite. A **primeira ação após a aprovação** é materializar esses 20 arquivos; depois a execução segue em ordem, marcando os checkboxes conforme avança.

| # | Tarefa | Entrega |
|---|---|---|
| 01 | Fundação do monorepo | pnpm workspaces, TS base, ESLint/Prettier, .editorconfig, .gitignore, git init, README inicial |
| 02 | Infraestrutura Docker de dev | `docker-compose.yml` com waha (NOWEB), postgres (2 databases), redis; **`.env.example` completo com todas as portas parametrizadas** (`WEB_PORT`, `API_PORT`, `POSTGRES_PORT`, `REDIS_PORT`, `WAHA_PORT`, `BIND_ADDRESS`); healthchecks; validar QR no console e subida com portas não-default |
| 03 | Modelagem de dados | Prisma schema completo, migration inicial, seed (aplicação demo + chave), scripts de db |
| 04 | Bootstrap da API | App Nest, ConfigModule com validação Zod, pino, filtro global de exceções, `ProblemDetails`, health, Swagger base |
| 05 | Autenticação por API key | Geração/hash/verificação, `ApiKeyGuard`, decorators `@Scopes`/`@CurrentApplication`, cache LRU, throttler |
| 06 | Autenticação do painel | Login com credenciais do `.env`, JWT + refresh, `AdminGuard`, rotação/revogação de refresh no Redis |
| 07 | Cliente WAHA tipado | Módulo `WahaClient` (undici), tipos de sessão/mensagem/evento, retry com backoff, tradução de erros, health check |
| 08 | Aplicações e API keys | CRUD admin de aplicações e chaves, exibição única do segredo, revogação, listagem com `lastUsedAt` |
| 09 | Sessões e fluxo de QR | Criação/ciclo de vida, `metadata` de rastreio, endpoint de QR com registro de origem, pairing code, reconciliação por cron |
| 10 | Ingestão de webhooks do WAHA | Endpoint interno, HMAC-SHA512 sobre corpo bruto, idempotência, atualização de status/número, persistência de mensagens recebidas e acks |
| 11 | Envio de mensagens | Texto + imagem/arquivo/voz/vídeo/localização/contato/reação, upload direto e por URL, persistência com `sentByApiKeyId`, tratamento de erro |
| 12 | Histórico, chats e mídia | Listagem paginada por cursor, filtros, chats/contatos via store NOWEB, proxy autenticado de mídia |
| 13 | Webhooks de saída | CRUD de endpoints, fila BullMQ, assinatura HMAC-SHA256, retries exponenciais, log de entregas, reenvio manual, endpoint de teste |
| 14 | Métricas, auditoria e SSE | Séries temporais (mensagens/dia, por aplicação, por sessão), taxa de entrega por ack, `AuditLog` transversal, SSE de eventos |
| 15 | Documentação OpenAPI | Decorators e exemplos em todos os DTOs, tags, `securitySchemes`, export de `openapi.json`, coleções Insomnia/Postman, guia de integração |
| 16 | Painel — fundação | Vite + Tailwind + shadcn/ui, TanStack Query + Router, tela de login, layout, tema, tratamento de erro e sessão expirada; front chama `/api` relativo (nginx com template `envsubst`, sem URL congelada no build) |
| 17 | Painel — sessões e QR | Lista de números conectados com status ao vivo, criação de sessão, modal de QR com atualização por SSE, ações start/stop/logout/excluir |
| 18 | Painel — mensagens e métricas | Tabela com filtros e detalhe da mensagem, dashboard com gráficos (volume, ack, sessões), visão por aplicação |
| 19 | Painel — apps, chaves, webhooks e auditoria | CRUD de aplicações e chaves com cópia única do segredo, endpoints de webhook e entregas com reenvio, timeline de auditoria |
| 20 | Testes, produção e entrega | Unit (Vitest) + e2e (supertest com WAHA mockado), Dockerfiles multi-stage, `docker-compose.prod.yml` (WAHA e Postgres sem publicar porta), nginx com `envsubst`, **teste de subida com portas não-default**, backup/restore, runbook e README final |

### Sequenciamento

`01 → 02 → 03 → 04` são fundação e travam tudo. `05` e `06` (auth) podem sair juntos. `07` habilita `09`, `10`, `11`, `12`. `13` e `14` dependem de `10`/`11`. O painel (`16`–`19`) depende da API estar de pé, mas as telas entre si são independentes. `15` e `20` fecham.

**Marcos verificáveis:**
- Após `02`: `docker compose up` sobe WAHA em NOWEB e o QR aparece nos logs.
- Após `10`: fluxo ponta a ponta em curl — criar aplicação, gerar chave, criar sessão, ler QR, escanear e ver o número gravado com o sistema de origem.
- Após `13`: mensagem recebida no WhatsApp chega assinada no endpoint do sistema integrador.
- Após `19`: painel completo operando sobre esse mesmo fluxo.

---

## Verificação

**Por tarefa** — cada arquivo `tasks/NN-*.md` tem critérios de aceite executáveis (comando + resultado esperado). Nada é marcado como concluído sem o comando ter rodado.

**Fluxo ponta a ponta (marco principal, após a tarefa 11):**

```bash
docker compose up -d && docker compose ps          # waha, postgres, redis, api saudáveis
curl -s localhost:3001/health/ready

# admin: cria aplicação e chave
TOKEN=$(curl -s -XPOST localhost:3001/admin/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"..."}' | jq -r .accessToken)
APP=$(curl -s -XPOST localhost:3001/admin/applications -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"CRM","slug":"crm"}' | jq -r .id)
KEY=$(curl -s -XPOST localhost:3001/admin/applications/$APP/api-keys -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"prod"}' | jq -r .secret)

# integrador: cria sessão e pega o QR
SID=$(curl -s -XPOST localhost:3001/v1/sessions -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{"label":"Comercial"}' | jq -r .id)
curl -s "localhost:3001/v1/sessions/$SID/qr" -H "x-api-key: $KEY" -o qr.png && xdg-open qr.png

# após escanear: o número aparece vinculado à aplicação de origem
curl -s "localhost:3001/v1/sessions/$SID" -H "x-api-key: $KEY" | jq '{status,phoneNumber,pushName,qrRequestCount}'

# envio e persistência
curl -s -XPOST localhost:3001/v1/messages/text -H "x-api-key: $KEY" \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"chatId\":\"5511999999999@c.us\",\"text\":\"ok\"}"
curl -s "localhost:3001/v1/messages?sessionId=$SID" -H "x-api-key: $KEY" | jq '.data[0]'
```

**Portas configuráveis** — o mesmo fluxo acima roda uma segunda vez com o `.env` alterado, provando que nada está fixo:

```bash
WEB_PORT=9090 API_PORT=4001 POSTGRES_PORT=5544 REDIS_PORT=6399 docker compose up -d
docker compose ps                       # todos saudáveis, portas novas no mapeamento
curl -s localhost:4001/health/ready      # gateway responde na porta nova
curl -s localhost:9090/ -o /dev/null -w '%{http_code}\n'   # painel serve e proxeia /api
grep -RnE ':(3000|3001|5432|6379|8080)' docker-compose*.yml docker/ apps/*/src | grep -v '\${'
# ^ não deve retornar porta fixa fora de interpolação/default
```

**Isolamento** — com a chave da aplicação B, `GET /v1/sessions/{id-da-A}` deve responder `404`; `POST /v1/messages/text` na sessão da A idem. Vira caso de teste e2e.

**Automatizado** — `pnpm test` (unit), `pnpm test:e2e` (supertest com WAHA mockado por MSW, Postgres efêmero), `pnpm lint`, `pnpm build`. Rodam antes de fechar a tarefa 20.

**Documentação** — Swagger UI navegável em `/docs`, `openapi.json` validando em linter OpenAPI, e o guia `docs/integracao.md` reproduzível por alguém de fora usando só curl.
