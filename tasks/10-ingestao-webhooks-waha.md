# 10 — Ingestão de webhooks do WAHA

**Status:** ✅ CONCLUÍDA
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
- [x] `POST /internal/waha/webhook`, marcado `@Public()` (não usa API key) e **excluído do Swagger público**
- [x] Verificação HMAC-SHA512 sobre `req.rawBody`, com `timingSafeEqual`
- [x] Chave: `Session.webhookSecret` resolvido por `event.session`; fallback para `WAHA_WEBHOOK_HMAC_KEY` global
- [x] Assinatura ausente ou inválida → 401 e log de alerta
- [x] Janela de tolerância no `X-Webhook-Timestamp` (`WEBHOOK_TOLERANCE_SECONDS`, default 300) contra replay
- [x] Middleware de rawBody aplicado **apenas** nessa rota

### Idempotência
- [x] `InboundEvent.wahaEventId @unique` gravado em transação com o processamento
- [x] Evento repetido → 200 imediato (`{ status: "duplicate" }`), sem reprocessar
- [x] Limpeza de `InboundEvent` com mais de N dias (job diário)

### Roteamento de eventos
- [x] Dispatcher mapeando `event` → handler, com handler default que só loga (evento desconhecido nunca derruba a ingestão)
- [x] `session.status` — atualiza `status`, `lastStatusAt`; em `WORKING` grava `phoneNumber` (normalizado do `me.id`), `waId`, `pushName`, `connectedAt`; em `STOPPED`/`FAILED` grava `disconnectedAt`
- [x] `message` e `message.any` — persiste `Message` com `direction` derivado de `fromMe`
- [x] `message.ack` — atualiza `ack`, `ackName` e promove `status` (SENT → DELIVERED → READ)
- [x] `message.reaction`, `message.edited`, `message.revoked` — atualizam o registro correspondente
- [x] `group.v2.*`, `presence.update`, `poll.vote`, `call.*`, `label.*` — persistidos como evento e repassados (tarefa 13), sem tabela dedicada
- [x] `engine.event` — só em log debug

### Persistência de mensagens
- [x] `applicationId` derivado de `metadata["application.id"]`, com fallback para lookup por `session`
- [x] Upsert por `@@unique([sessionId, wahaId])`
- [x] `timestamp` do WhatsApp (segundos) convertido corretamente para `DateTime`
- [x] Payload completo guardado em `raw` (útil para depurar formato do NOWEB)
- [x] Mídia: guardar `mediaUrl`, `mediaMimeType`, `mediaSize` — **sem baixar o arquivo aqui** (o proxy da tarefa 12 resolve sob demanda)
- [x] Corpo de texto truncado com limite configurável antes de persistir

### Repasse
- [x] Após persistir, enfileirar o evento para os `WebhookEndpoint` da aplicação (fila da tarefa 13)
- [x] Emitir no barramento interno para o SSE do painel (tarefa 14)

### Resiliência
- [x] Handler que lança exceção **não** derruba os demais; erro é logado e o endpoint devolve 200 se o evento já foi registrado
- [x] Sessão desconhecida (evento de sessão criada fora do gateway) é logada e ignorada sem erro
- [x] Métrica de eventos recebidos/processados/ignorados/falhos

### Testes
- [x] unit: HMAC válido passa; corpo alterado em 1 byte falha; timestamp velho falha
- [x] unit: mesmo `event.id` duas vezes gera um registro só
- [x] unit: `session.status=WORKING` grava número, pushName e `connectedAt`
- [x] unit: `message.ack` promove o status na ordem certa e nunca regride
- [x] e2e: POST assinado cria a mensagem e vincula à aplicação correta

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

### O vínculo se fechou — verificado ponta a ponta

Enviando um `session.status = WORKING` assinado, a sessão passou a ter:

```
phoneNumber : 5511988887777
pushName    : Número de Teste
connectedAt : 2026-08-26T21:44:00.783Z
```

É o requisito central completo: a sessão já sabia qual aplicação e qual chave pediram o QR
(tarefa 09); este evento trouxe o `me.id` e amarrou o número.

Curiosidade útil do teste: logo depois, o `status` voltou a `SCAN_QR_CODE`. Não é bug — a
sincronização em cada leitura corrigiu com o estado **real** do WAHA, onde ninguém escaneou
nada. A rede de segurança funcionando.

### Idempotência exata

Cinco entregas do mesmo evento: **1 processado, 4 duplicados**, resultando em 1 mensagem e
1 registro em `inbound_events`. Sem isso, uma instabilidade durante as 15 retentativas do
WAHA multiplicaria cada mensagem recebida.

A trava é gravada **antes** do processamento: se a inserção colide, o evento já foi tratado.

### O status de mensagem nunca regride

Testado com acks fora de ordem:

```
ack=1 -> DELIVERED (ack=1)
ack=3 -> READ      (ack=3)
ack=2 -> READ      (ack=2)   <- não voltou
ack=1 -> READ      (ack=1)   <- não voltou
```

Sem `MESSAGE_STATUS_RANK`, um ack atrasado faria a mensagem "voltar no tempo" no painel.
`FAILED` é a exceção deliberada: sempre vence, porque é informação nova e definitiva.

### Falha de handler devolve 200, não erro

Se um handler lançar depois do evento já registrado, respondemos 200 mesmo assim. Devolver
erro faria o WAHA gastar as 15 retentativas batendo contra a trava de idempotência, sem
efeito algum. O erro vai para o log com o `eventId`.

### Segredo por sessão, não global

A verificação usa `Session.webhookSecret` (gerado na tarefa 09), resolvido pelo nome da
sessão. Assim, comprometer uma sessão não permite forjar eventos das outras. O segredo
global é só a alternativa, para sessões criadas fora do gateway.

### O endpoint fica fora do Swagger e do rate limit

Fora do Swagger porque publicar o endpoint interno seria entregar mapa de superfície de
ataque. Fora do rate limit porque, numa rajada (sincronização inicial de histórico), barrar
eventos provocaria retentativas em cascata do lado do WAHA.

### Detalhes que evitam dados errados

- **Timestamp**: o WhatsApp usa segundos, o JavaScript milissegundos. A conversão detecta
  qual é pela magnitude (`< 10^12` = segundos).
- **Tipo da mensagem**: o NOWEB nem sempre traz `type`, então é inferido pelo mimetype —
  cair em "unknown" quebraria o filtro por tipo do painel.
- **Upsert, não create**: `message` e `message.any` podem trazer a mesma mensagem, e um
  envio nosso já terá registro criado pela tarefa 11. A reentrega só enriquece (URL de
  mídia que chegou depois), nunca sobrescreve o que já se sabe.
- **Corpo truncado** em 16 000 caracteres antes de persistir.

### Verificação executada

```
assinatura forjada                401 invalid-signature
evento com 1h de idade (replay)   401 stale-event
evento assinado corretamente      200 {"status":"processado"}

vínculo após session.status=WORKING:
  phoneNumber / pushName / connectedAt   todos preenchidos

idempotência: mesmo evento x5     1 processado + 4 duplicados
  mensagens no banco              1
  inbound_events                  1

mensagem persistida               INBOUND | 5511977776666@c.us | text | DELIVERED

progressão de ack                 1->DELIVERED, 3->READ, 2->READ, 1->READ

pnpm test                         83 testes, 5 arquivos
```

Inclui `scripts/send-test-webhook.ts`, que assina eventos como o WAHA faria — permite
exercitar toda a ingestão sem depender de um WhatsApp real.
