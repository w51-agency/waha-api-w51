# 03 — Modelagem de dados (Prisma)

**Status:** ✅ CONCLUÍDA
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
- [x] `Application` — `id (cuid), name, slug @unique, description?, active, createdAt, updatedAt`
- [x] `ApiKey` — `id, applicationId, name, prefix @unique, hash, scopes String[], lastUsedAt?, expiresAt?, revokedAt?, createdAt`
- [x] `Session` — `id, applicationId, name @unique (nome no WAHA), label?, status, engine, phoneNumber?, waId?, pushName?, qrRequestCount, lastQrRequestedAt?, connectedAt?, disconnectedAt?, lastStatusAt?, createdByApiKeyId?, createdVia, webhookSecret, meta Json?`
- [x] `Message` — `id, applicationId, sessionId, wahaId?, direction, chatId, fromMe, type, body?, mediaUrl?, mediaMimeType?, mediaSize?, ack?, ackName?, status, error?, sentByApiKeyId?, timestamp, raw Json?`
- [x] `WebhookEndpoint` — `id, applicationId, url, secret, events String[], active, description?, createdAt, updatedAt`
- [x] `WebhookDelivery` — `id, endpointId, eventId, eventType, payload Json, attempts, status, responseStatus?, responseBody?, error?, nextRetryAt?, deliveredAt?, createdAt`
- [x] `InboundEvent` — `id, wahaEventId @unique, eventType, sessionName, receivedAt` (idempotência da ingestão)
- [x] `AuditLog` — `id, actorType, actorId?, actorLabel?, action, resourceType?, resourceId?, ip?, userAgent?, metadata Json?, createdAt`

### Enums
- [x] `SessionStatus`: STOPPED, STARTING, SCAN_QR_CODE, PASSKEY_REQUIRED, PASSKEY_CONFIRMATION_REQUIRED, WORKING, FAILED, UNKNOWN
- [x] `Direction`: INBOUND, OUTBOUND
- [x] `MessageStatus`: QUEUED, SENT, DELIVERED, READ, FAILED
- [x] `CreatedVia`: API, DASHBOARD
- [x] `DeliveryStatus`: PENDING, RETRYING, SUCCESS, FAILED, ABANDONED
- [x] `ActorType`: ADMIN, API_KEY, SYSTEM

### Índices e integridade
- [x] `Message @@unique([sessionId, wahaId])` — evita duplicata na reentrega de webhook
- [x] `Message @@index([applicationId, timestamp(sort: Desc)])` e `@@index([sessionId, timestamp(sort: Desc)])`
- [x] `Message @@index([chatId])`, `Session @@index([applicationId, status])`
- [x] `AuditLog @@index([createdAt(sort: Desc)])`, `@@index([resourceType, resourceId])`
- [x] `WebhookDelivery @@index([status, nextRetryAt])` — a fila varre por aqui
- [x] `onDelete: Cascade` de `Application` para `ApiKey`, `Session`, `WebhookEndpoint`
- [x] `onDelete: SetNull` em `Message.sentByApiKeyId` e `Session.createdByApiKeyId` (histórico sobrevive à revogação da chave)

### Infra do Prisma
- [x] `apps/api/prisma/schema.prisma` com `provider = "postgresql"` e `previewFeatures` se necessário
- [x] Migration inicial gerada e aplicada (`prisma migrate dev --name init`)
- [x] `prisma/seed.ts`: aplicação `demo`, uma API key (imprimir o segredo no console), idempotente via `upsert`
- [x] Scripts em `apps/api/package.json`: `db:generate`, `db:migrate`, `db:deploy`, `db:seed`, `db:studio`, `db:reset`
- [x] Enums e tipos de domínio reexportados de `packages/shared` para o painel usar

### Documentação
- [x] `docs/modelo-de-dados.md` com diagrama textual das relações e o porquê de cada campo não óbvio (`prefix`, `webhookSecret`, `raw`, `qrRequestCount`)

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

### Ajustes em relação ao checklist original

- **`ApiKey.prefix` guarda a parte pública completa** (`wgw_live_a1b2c3d4e5f6`), não só o
  namespace. Assim ela é única, indexável e exibível no painel de uma vez só — em vez de
  precisar de duas colunas para o que é um valor só.
- **Campos extras não previstos**, incluídos porque as tarefas seguintes precisariam deles
  e acrescentá-los depois custaria migration: `Session.webhookSecret` (HMAC por sessão,
  tarefa 10), `WebhookEndpoint.consecutiveFailures/disabledAt/disabledReason`
  (desligamento automático, tarefa 13), `Message.durationMs` e `AuditLog.actorLabel`.
- **`AuditLog.actorLabel` guarda o rótulo no momento do registro**, sem junção. Parece
  redundância até a chave ser revogada e excluída — que é justamente quando alguém pergunta
  quem fez aquilo. Auditoria que depende de junção com o ator perde o sentido quando o ator
  some.

### Prisma 7 — três armadilhas

O `pnpm add prisma` resolveu para **8.0.0-rc.12**: o dist-tag `latest` do Prisma no npm
aponta para um release candidate, e o `@prisma/client` veio 7.10.0 — majors divergentes.
Ambos fixados em `7.10.0` exato (sem `^`), para que nunca se separem.

1. **`url` saiu do `datasource`.** No Prisma 7 a URL vive em `prisma.config.ts` e o client
   recebe um driver adapter (`@prisma/adapter-pg`). O schema só declara o provider.

2. **`migrations.path` explícito quebra o `migrate status` em silêncio.** Eu havia declarado
   `path: 'prisma/migrations'`; o Prisma 7 resolve isso relativo ao diretório do schema, ou
   seja `prisma/prisma/migrations`. Resultado: `migrate status` reportando *"0 applied,
   0 pending"* com a migration aplicada e presente no disco. Isso teria inutilizado o
   `migrate deploy` na tarefa 20 sem dar sinal. O default (ao lado do schema) está correto —
   não declarar o `path`.

3. **O generator `prisma-client-js` não resolve com o node_modules isolado do pnpm.** O
   `@prisma/client/default.js` tentava carregar `.prisma/client` a partir da própria pasta
   e falhava com `MODULE_NOT_FOUND`. Trocado pelo generator `prisma-client` do Prisma 7,
   que emite o client como código em `src/generated/prisma`. É artefato de build: entrou no
   `.gitignore` e é regenerado por um `postinstall`.

### Decisão: `packages/shared` redeclara os enums

Em vez de reexportar do client gerado. O painel roda no navegador e não deve arrastar o
Prisma para o bundle. O custo é manter duas listas alinhadas — mitigado por um teste de
alinhamento previsto na tarefa 20, que falha se divergirem.

O `shared` ganhou também `MESSAGE_STATUS_RANK` e `ACK_TO_STATUS`, que a tarefa 10 usa para
garantir que o status de uma mensagem **nunca regrida** quando os webhooks de ack chegam
fora de ordem.

### `@@unique([sessionId, wahaId])` e o NULL do Postgres

A trava contra reentrega duplicada funciona porque no Postgres `NULL` é distinto de `NULL`
em índice único: várias mensagens recém-enfileiradas (ainda sem `wahaId`) coexistem sem
violar a restrição, que só passa a valer quando o id real chega. Sem essa semântica, seria
preciso um índice parcial.

### Código adiantado da tarefa 05

`src/common/crypto/api-key.crypto.ts` foi escrito aqui porque o seed precisa emitir uma
chave. Deixá-lo puro (sem Nest) permite que o seed e o futuro `ApiKeyService` compartilhem
exatamente a mesma lógica — duplicar código de credencial é como as duas metades se perdem
de vista em silêncio.

Medição do argon2id no perfil OWASP: **~23 ms por verificação**. É o número que justifica o
cache LRU de 60 s da tarefa 05.

### Verificação executada

```
prisma validate                    schema válido
prisma migrate dev --name init     migration 20260826180204_init aplicada
prisma migrate status              1 migration found / Database schema is up to date
prisma migrate diff                No difference detected
tabelas criadas                    9 (8 do domínio + _prisma_migrations)
índices de messages                unique(session_id, waha_id) + 4 de consulta

seed 1a execução                   aplicação demo + chave emitida
seed 2a execução                   "já existe", sem duplicar
chaves ativas do seed              1
db:seed:reset-key                  revogou a anterior, emitiu nova (verificado no banco)

helper de criptografia
  gera / parseia / verifica         OK
  segredo adulterado                rejeitado
  entrada inválida ou de outro tipo  null, sem lançar
  safeCompare                       true/false correto
  custo do argon2                   23 ms

pnpm typecheck / lint / format:check / build   todos verdes
```
