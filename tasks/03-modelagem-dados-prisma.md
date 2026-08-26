# 03 — Modelagem de dados (Prisma)

**Status:** ⬜ pendente
**Depende de:** 02
**Habilita:** 04 em diante

## Objetivo

Definir o schema Prisma completo do gateway, gerar a migration inicial e um seed que
deixa o ambiente utilizável (uma aplicação demo com uma API key). Este é o contrato de
dados que todas as tarefas seguintes consomem — vale investir em acertar de primeira.

## Contexto

O WAHA guarda **as sessões do WhatsApp** no seu próprio database (`waha`). O nosso schema
guarda **o que o WAHA não sabe**: qual sistema integrador é dono de cada sessão, qual API
key pediu o QR, o histórico de mensagens atribuído a cada aplicação e a trilha de auditoria.
São databases separados no mesmo Postgres — sem colisão.

Decisão de projeto confirmada: **isolamento por aplicação**. Cada API key enxerga e opera
apenas sobre as sessões da sua própria `Application`. O modelo precisa carregar
`applicationId` em tudo que é consultável para que o filtro seja barato e nunca esquecido.

## Checklist

### Modelos
- [ ] `Application` — `id (cuid), name, slug @unique, description?, active, createdAt, updatedAt`
- [ ] `ApiKey` — `id, applicationId, name, prefix @unique, hash, scopes String[], lastUsedAt?, expiresAt?, revokedAt?, createdAt`
- [ ] `Session` — `id, applicationId, name @unique (nome no WAHA), label?, status, engine, phoneNumber?, waId?, pushName?, qrRequestCount, lastQrRequestedAt?, connectedAt?, disconnectedAt?, lastStatusAt?, createdByApiKeyId?, createdVia, webhookSecret, meta Json?`
- [ ] `Message` — `id, applicationId, sessionId, wahaId?, direction, chatId, fromMe, type, body?, mediaUrl?, mediaMimeType?, mediaSize?, ack?, ackName?, status, error?, sentByApiKeyId?, timestamp, raw Json?`
- [ ] `WebhookEndpoint` — `id, applicationId, url, secret, events String[], active, description?, createdAt, updatedAt`
- [ ] `WebhookDelivery` — `id, endpointId, eventId, eventType, payload Json, attempts, status, responseStatus?, responseBody?, error?, nextRetryAt?, deliveredAt?, createdAt`
- [ ] `InboundEvent` — `id, wahaEventId @unique, eventType, sessionName, receivedAt` (idempotência da ingestão)
- [ ] `AuditLog` — `id, actorType, actorId?, actorLabel?, action, resourceType?, resourceId?, ip?, userAgent?, metadata Json?, createdAt`

### Enums
- [ ] `SessionStatus`: STOPPED, STARTING, SCAN_QR_CODE, PASSKEY_REQUIRED, PASSKEY_CONFIRMATION_REQUIRED, WORKING, FAILED, UNKNOWN
- [ ] `Direction`: INBOUND, OUTBOUND
- [ ] `MessageStatus`: QUEUED, SENT, DELIVERED, READ, FAILED
- [ ] `CreatedVia`: API, DASHBOARD
- [ ] `DeliveryStatus`: PENDING, RETRYING, SUCCESS, FAILED, ABANDONED
- [ ] `ActorType`: ADMIN, API_KEY, SYSTEM

### Índices e integridade
- [ ] `Message @@unique([sessionId, wahaId])` — evita duplicata na reentrega de webhook
- [ ] `Message @@index([applicationId, timestamp(sort: Desc)])` e `@@index([sessionId, timestamp(sort: Desc)])`
- [ ] `Message @@index([chatId])`, `Session @@index([applicationId, status])`
- [ ] `AuditLog @@index([createdAt(sort: Desc)])`, `@@index([resourceType, resourceId])`
- [ ] `WebhookDelivery @@index([status, nextRetryAt])` — a fila varre por aqui
- [ ] `onDelete: Cascade` de `Application` para `ApiKey`, `Session`, `WebhookEndpoint`
- [ ] `onDelete: SetNull` em `Message.sentByApiKeyId` e `Session.createdByApiKeyId` (histórico sobrevive à revogação da chave)

### Infra do Prisma
- [ ] `apps/api/prisma/schema.prisma` com `provider = "postgresql"` e `previewFeatures` se necessário
- [ ] Migration inicial gerada e aplicada (`prisma migrate dev --name init`)
- [ ] `prisma/seed.ts`: aplicação `demo`, uma API key (imprimir o segredo no console), idempotente via `upsert`
- [ ] Scripts em `apps/api/package.json`: `db:generate`, `db:migrate`, `db:deploy`, `db:seed`, `db:studio`, `db:reset`
- [ ] Enums e tipos de domínio reexportados de `packages/shared` para o painel usar

### Documentação
- [ ] `docs/modelo-de-dados.md` com diagrama textual das relações e o porquê de cada campo não óbvio (`prefix`, `webhookSecret`, `raw`, `qrRequestCount`)

## Critérios de aceite

```bash
cd apps/api
pnpm db:migrate                        # migration aplicada sem erro
pnpm db:seed                           # imprime a API key da aplicação demo
pnpm db:generate && pnpm typecheck     # client tipado compila

# tabelas criadas
docker compose exec postgres psql -U gateway -d gateway -c '\dt'

# a unicidade que protege contra reentrega funciona
docker compose exec postgres psql -U gateway -d gateway \
  -c "\d messages" | grep -i unique

pnpm prisma migrate diff --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource prisma/schema.prisma --exit-code   # 0 = schema e banco em sincronia
```

- `pnpm db:seed` rodado duas vezes seguidas não duplica nada nem falha.

## Notas

_(preencher durante a execução)_
