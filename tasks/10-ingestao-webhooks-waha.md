# 10 — Ingestão de webhooks do WAHA

**Status:** ⬜ pendente
**Depende de:** 07, 09
**Habilita:** 11, 13, 14, 17

## Objetivo

Receber, autenticar e processar os eventos que o WAHA envia: mudanças de status de sessão
(que **fecham o vínculo número ↔ sistema**), mensagens recebidas, confirmações de entrega
e leitura. É o marco em que o fluxo do QR passa a funcionar ponta a ponta.

## Contexto

O WAHA entrega eventos em `POST {GATEWAY_INTERNAL_URL}/internal/waha/webhook` com este
envelope (formato confirmado na documentação oficial):

```json
{
  "id": "evt_1111111111111111111111111111",
  "timestamp": 1741249702485,
  "event": "session.status",
  "session": "crm--k3n9x2",
  "metadata": { "application.id": "...", "gateway.session.id": "..." },
  "me": { "id": "5511999999999@c.us", "pushName": "Comercial" },
  "payload": { "status": "WORKING" },
  "environment": { "tier": "CORE", "version": "..." },
  "engine": "NOWEB"
}
```

Assinado com **HMAC-SHA512 do corpo bruto**, nos headers `X-Webhook-Hmac`,
`X-Webhook-Hmac-Algorithm`, `X-Webhook-Request-Id` e `X-Webhook-Timestamp`.

Quatro armadilhas a evitar:

1. **O HMAC é sobre o corpo bruto.** Se o body for parseado e reserializado, a assinatura
   não bate (ordem de chaves, espaços). Usar o `rawBody` habilitado na tarefa 04 e comparar
   com `timingSafeEqual`.
2. **Reentrega é garantida, não excepcional.** O WAHA retenta até 15 vezes com backoff.
   Sem idempotência, uma mensagem recebida vira 15 registros. A tabela `InboundEvent` com
   `wahaEventId @unique` é a trava, complementada pelo `@@unique([sessionId, wahaId])` em
   `Message`.
3. **Responder rápido.** O WAHA considera falha se demorar; qualquer trabalho pesado
   (repasse ao integrador, download de mídia) vai para fila e o endpoint responde 200 assim
   que persistiu. Processamento síncrono aqui vira retentativa em cascata.
4. **`session.status = WORKING` é o evento mais importante do sistema** — é ele que traz o
   `me.id` e permite gravar o número junto da aplicação que pediu o QR. Se algo aqui falhar
   em silêncio, o produto perde a funcionalidade principal.

## Checklist

### Endpoint e autenticação
- [ ] `POST /internal/waha/webhook`, marcado `@Public()` (não usa API key) e **excluído do Swagger público**
- [ ] Verificação HMAC-SHA512 sobre `req.rawBody`, com `timingSafeEqual`
- [ ] Chave: `Session.webhookSecret` resolvido por `event.session`; fallback para `WAHA_WEBHOOK_HMAC_KEY` global
- [ ] Assinatura ausente ou inválida → 401 e log de alerta
- [ ] Janela de tolerância no `X-Webhook-Timestamp` (`WEBHOOK_TOLERANCE_SECONDS`, default 300) contra replay
- [ ] Middleware de rawBody aplicado **apenas** nessa rota

### Idempotência
- [ ] `InboundEvent.wahaEventId @unique` gravado em transação com o processamento
- [ ] Evento repetido → 200 imediato (`{ status: "duplicate" }`), sem reprocessar
- [ ] Limpeza de `InboundEvent` com mais de N dias (job diário)

### Roteamento de eventos
- [ ] Dispatcher mapeando `event` → handler, com handler default que só loga (evento desconhecido nunca derruba a ingestão)
- [ ] `session.status` — atualiza `status`, `lastStatusAt`; em `WORKING` grava `phoneNumber` (normalizado do `me.id`), `waId`, `pushName`, `connectedAt`; em `STOPPED`/`FAILED` grava `disconnectedAt`
- [ ] `message` e `message.any` — persiste `Message` com `direction` derivado de `fromMe`
- [ ] `message.ack` — atualiza `ack`, `ackName` e promove `status` (SENT → DELIVERED → READ)
- [ ] `message.reaction`, `message.edited`, `message.revoked` — atualizam o registro correspondente
- [ ] `group.v2.*`, `presence.update`, `poll.vote`, `call.*`, `label.*` — persistidos como evento e repassados (tarefa 13), sem tabela dedicada
- [ ] `engine.event` — só em log debug

### Persistência de mensagens
- [ ] `applicationId` derivado de `metadata["application.id"]`, com fallback para lookup por `session`
- [ ] Upsert por `@@unique([sessionId, wahaId])`
- [ ] `timestamp` do WhatsApp (segundos) convertido corretamente para `DateTime`
- [ ] Payload completo guardado em `raw` (útil para depurar formato do NOWEB)
- [ ] Mídia: guardar `mediaUrl`, `mediaMimeType`, `mediaSize` — **sem baixar o arquivo aqui** (o proxy da tarefa 12 resolve sob demanda)
- [ ] Corpo de texto truncado com limite configurável antes de persistir

### Repasse
- [ ] Após persistir, enfileirar o evento para os `WebhookEndpoint` da aplicação (fila da tarefa 13)
- [ ] Emitir no barramento interno para o SSE do painel (tarefa 14)

### Resiliência
- [ ] Handler que lança exceção **não** derruba os demais; erro é logado e o endpoint devolve 200 se o evento já foi registrado
- [ ] Sessão desconhecida (evento de sessão criada fora do gateway) é logada e ignorada sem erro
- [ ] Métrica de eventos recebidos/processados/ignorados/falhos

### Testes
- [ ] unit: HMAC válido passa; corpo alterado em 1 byte falha; timestamp velho falha
- [ ] unit: mesmo `event.id` duas vezes gera um registro só
- [ ] unit: `session.status=WORKING` grava número, pushName e `connectedAt`
- [ ] unit: `message.ack` promove o status na ordem certa e nunca regride
- [ ] e2e: POST assinado cria a mensagem e vincula à aplicação correta

## Critérios de aceite

```bash
# assinatura inválida é rejeitada
curl -s -o /dev/null -w '%{http_code}\n' -XPOST localhost:3001/internal/waha/webhook \
  -H 'content-type: application/json' -H 'x-webhook-hmac: invalido' -d '{"id":"e1"}'   # 401

# evento assinado corretamente é aceito (script gera o HMAC)
cd apps/api && pnpm ts-node scripts/send-test-webhook.ts session.status WORKING
curl -s localhost:3001/v1/sessions/$SID -H "x-api-key: $KEY" | jq '{status,phoneNumber,pushName}'

# reentrega não duplica
pnpm ts-node scripts/send-test-webhook.ts message --repeat 3
docker compose exec postgres psql -U gateway -d gateway \
  -c "select count(*) from messages where waha_id='<id-do-teste>';"    # 1

pnpm test -- webhook-ingest
pnpm test:e2e -- webhook
```

**Marco do projeto** — o fluxo completo, com celular na mão:

```bash
SID=$(curl -s -XPOST localhost:3001/v1/sessions -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{"label":"Teste"}' | jq -r .id)
curl -s "localhost:3001/v1/sessions/$SID/qr" -H "x-api-key: $KEY" -o qr.png && xdg-open qr.png
# escanear, então:
curl -s localhost:3001/v1/sessions/$SID -H "x-api-key: $KEY" \
  | jq '{status,phoneNumber,pushName,qrRequestCount,connectedAt}'
# enviar uma mensagem PARA esse número pelo celular e conferir que ela apareceu:
docker compose exec postgres psql -U gateway -d gateway \
  -c "select direction, chat_id, left(body,40), timestamp from messages order by timestamp desc limit 3;"
```

## Notas

_(preencher durante a execução)_
