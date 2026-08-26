# Modelo de dados

Nove tabelas no database `gateway`. O database `waha`, ao lado, é gerenciado pelo próprio
WAHA e guarda as sessões do WhatsApp — não o tocamos.

A divisão é essa: **o WAHA sabe conversar com o WhatsApp; nós sabemos de quem é cada
conversa.**

## Relações

```
Application ──┬── ApiKey        (credenciais do integrador)
              ├── Session       (números de WhatsApp)
              ├── Message       (histórico atribuído)
              └── WebhookEndpoint ── WebhookDelivery

Session ────────── Message

ApiKey ─┬─(SetNull)─ Session.createdByApiKey
        └─(SetNull)─ Message.sentByApiKey

InboundEvent   (isolada — trava de idempotência)
AuditLog       (isolada — trilha transversal)
```

## O princípio: isolamento por aplicação

Toda tabela consultável carrega `applicationId`, inclusive quando poderia ser derivado por
junção. `Message` tem `applicationId` mesmo já tendo `sessionId`, e isso é deliberado: o
filtro de isolamento é a defesa mais importante da API, e ele precisa ser barato
(um índice, sem junção) e impossível de esquecer.

O custo é uma coluna redundante. O benefício é que `where: { applicationId }` funciona
uniformemente em toda consulta, e o índice `[applicationId, timestamp desc]` serve tanto a
listagem quanto a paginação por cursor.

## Tabelas

### `applications` — os sistemas integradores

Um registro por sistema que consome o gateway.

O `slug` é **imutável após a criação** porque entra na composição do nome técnico da sessão
no WAHA (`{slug}--{nanoid}`). Renomeá-lo deixaria sessões existentes com nome que não
corresponde mais a aplicação alguma.

### `api_keys` — credenciais

Formato entregue ao integrador:

```
wgw_live_a1b2c3d4e5f6_9fK2xQ7mNp...
└──── prefix ───────┘ └─ segredo ─┘
        (indexado)      (só o hash)
```

- **`prefix`** é público, único e indexado. Localiza o registro em uma query antes de
  qualquer trabalho caro, e é o que o painel exibe para identificar a chave depois.
- **`hash`** é argon2id do segredo (perfil OWASP: 19 MiB, 2 iterações). Medido em ~23 ms
  por verificação — deliberadamente caro, e a razão pela qual a tarefa 05 mantém um cache
  de 60 s: pagar isso por requisição inviabilizaria a API.
- O segredo em claro **existe apenas na resposta de criação**. Perdeu, gera outra.

**Revogação é soft** (`revokedAt`), nunca `DELETE`: `Message.sentByApiKey` e
`Session.createdByApiKey` precisam continuar apontando para ela. Uma chave revogada há um
ano ainda responde "quem enviou esta mensagem".

### `sessions` — os números conectados

Onde vive o requisito central do projeto — o rastreio de origem do QR code:

| Campo | Papel |
|---|---|
| `createdByApiKeyId` | qual chave criou a sessão |
| `qrRequestCount` | quantas vezes o QR foi pedido |
| `lastQrRequestedAt` | quando foi o último pedido |
| `phoneNumber`, `waId`, `pushName` | preenchidos quando conecta, a partir do `me.id` do webhook |
| `connectedAt` | o instante em que o vínculo sistema ↔ número se fechou |

O `name` é o nome técnico no WAHA, gerado por nós (`{slug}--{nanoid}`) e **nunca escolhido
pelo integrador nem reutilizado após exclusão** — o WAHA pode manter estado residual de uma
sessão removida, e reaproveitar o nome traria esse estado de volta.

`webhookSecret` é o HMAC próprio de cada sessão. Por sessão, e não global, para que o
comprometimento de uma não permita forjar eventos das outras.

`@@unique([applicationId, label])` deixa dois sistemas diferentes usarem o mesmo apelido
("Comercial") sem colidir.

### `messages` — o histórico

`@@unique([sessionId, wahaId])` é a trava contra duplicata. Ela importa porque **o WAHA
retenta a entrega de webhook até 15 vezes**: sem ela, uma mensagem recebida durante uma
instabilidade viraria 15 registros.

Detalhe que a faz funcionar: no Postgres, `NULL` é distinto de `NULL` em índice único. Uma
mensagem recém-enfileirada ainda não tem `wahaId`, e várias podem coexistir nesse estado
sem violar a restrição — que só passa a valer quando o id real chega.

`status` progride de forma monotônica (`QUEUED → SENT → DELIVERED → READ`) e **nunca
regride**, mesmo com webhooks de ack chegando fora de ordem. A ordem é definida por
`MESSAGE_STATUS_RANK` em `@gateway/shared`.

`raw` guarda o payload original do WAHA. Ocupa espaço, mas o formato do NOWEB difere do
WEBJS em detalhes que só aparecem em produção — sem o cru, depurar vira adivinhação.

### `webhook_endpoints` e `webhook_deliveries`

Os endpoints para onde repassamos eventos. `consecutiveFailures`, `disabledAt` e
`disabledReason` sustentam o desligamento automático: um endpoint que falha continuamente
é desativado com o motivo registrado, em vez de queimar a fila indefinidamente.

`WebhookDelivery` registra **cada tentativa**, com código HTTP, corpo truncado e duração. O
índice `[status, nextRetryAt]` é por onde a fila varre o que está pendente.

### `inbound_events` — idempotência

Uma linha por evento do WAHA, com `wahaEventId @unique`. É a primeira coisa gravada na
ingestão; se a inserção colidir, o evento já foi processado e a requisição responde 200 sem
reprocessar.

Cresce rápido e é expurgada por job periódico — daí o índice em `receivedAt`.

### `audit_logs` — a trilha

Responde, meses depois, "quem conectou este número e quando".

`actorLabel` guarda o rótulo legível **no momento do registro**, e não por junção. Parece
redundante até a chave ser revogada e excluída — que é exatamente quando a pergunta é feita.
Auditoria que depende de junção com o ator perde o sentido quando o ator some.

Ações seguem o padrão `recurso.verbo`: `session.qr.requested`, `apikey.revoked`,
`application.deactivated`.

## Enums

Declarados em três lugares que precisam permanecer alinhados: `schema.prisma`,
`packages/shared/src/index.ts` e os valores que o WAHA emite.

O `shared` **redeclara** em vez de reexportar do client gerado, de propósito: o painel roda
no navegador e não deve arrastar o Prisma para o bundle. Um teste de alinhamento
(tarefa 20) falha se as duas listas divergirem.

`SessionStatus.UNKNOWN` existe para o caso de o WAHA passar a emitir um status novo: a
ingestão registra como desconhecido em vez de explodir.

## Comandos

```bash
cd apps/api
pnpm db:migrate      # cria e aplica migration em desenvolvimento
pnpm db:deploy       # aplica migrations em produção (nunca db:migrate lá)
pnpm db:seed         # aplicação demo + API key (idempotente)
pnpm db:seed:reset-key   # revoga a chave do seed e emite outra
pnpm db:studio       # navegador visual das tabelas
pnpm db:status       # migrations aplicadas x pendentes
pnpm db:reset        # APAGA TUDO e recria
```

## Notas sobre o Prisma 7

Três diferenças em relação ao Prisma 6 que custaram tempo e valem registro:

1. **`url` saiu do `datasource`** e vive em `prisma.config.ts`. Em tempo de execução o
   client recebe um driver adapter (`@prisma/adapter-pg`).
2. **`migrations.path` explícito quebra o `migrate status`.** O Prisma 7 resolve esse
   caminho relativo ao diretório do schema, então `'prisma/migrations'` vira
   `prisma/prisma/migrations` e ele relata "0 migrations" com o banco em dia — o que
   silenciosamente inutilizaria o `migrate deploy` em produção. O default (ao lado do
   schema) está correto; não declare o `path`.
3. **O generator `prisma-client-js` não resolve com o node_modules isolado do pnpm.** Usamos
   o generator `prisma-client`, que emite o client como código em `src/generated/prisma`.
   É artefato de build: fica no `.gitignore` e é regenerado no `postinstall`.
