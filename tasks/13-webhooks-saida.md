# 13 — Webhooks de saída para os integradores

**Status:** ⬜ pendente
**Depende de:** 10
**Habilita:** 19

## Objetivo

Permitir que cada sistema integrador cadastre URLs e receba os eventos das **suas**
sessões — com assinatura HMAC, entrega assíncrona por fila, retentativas com backoff
exponencial e registro completo de cada tentativa.

## Contexto

Sem isto, o integrador só saberia de mensagens recebidas fazendo polling. Este é o caminho
inverso: o gateway avisa.

Decisões de projeto:

- **Fila BullMQ, nunca entrega síncrona.** O endpoint do integrador pode estar lento ou
  fora do ar; segurar a ingestão do WAHA esperando por ele causaria retentativa em cascata
  do lado do WAHA. A ingestão (tarefa 10) apenas enfileira.
- **Assinatura no estilo Stripe**: `X-Gateway-Signature: t=<unix>,v1=<hmac-sha256>`, onde o
  HMAC cobre `"{t}.{body}"`. Incluir o timestamp **dentro** do que é assinado é o que
  impede replay — assinar só o corpo permitiria reenviar a requisição capturada
  indefinidamente.
- **Isolamento também aqui**: o endpoint da aplicação A jamais recebe evento de sessão da
  aplicação B. O filtro é por `applicationId` do evento.
- **Retry com jitter.** Backoff exponencial sem aleatoriedade faz todas as entregas
  falhadas baterem no mesmo instante quando o destino volta — jitter espalha.
- **Circuito por endpoint**: endpoint que falha continuamente é desativado automaticamente
  após N falhas consecutivas, com registro do motivo, para não queimar fila indefinidamente.

## Checklist

### CRUD (API pública)
- [ ] `POST /v1/webhook-endpoints` — `{ url, events[], description? }`; devolve `secret` **uma única vez**
- [ ] `GET /v1/webhook-endpoints`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`
- [ ] `POST /v1/webhook-endpoints/{id}/rotate-secret`
- [ ] `POST /v1/webhook-endpoints/{id}/test` — dispara um evento `ping` sintético
- [ ] Validação anti-SSRF na URL (só https em produção; http permitido só se `ALLOW_INSECURE_WEBHOOKS=true`; IPs privados bloqueados)
- [ ] Limite de endpoints por aplicação configurável
- [ ] Escopo `webhooks:manage` exigido

### Assinatura
- [ ] `X-Gateway-Signature: t=<unix>,v1=<hmac-sha256 de "{t}.{body}">`
- [ ] Headers `X-Gateway-Event`, `X-Gateway-Event-Id`, `X-Gateway-Delivery-Id`, `X-Gateway-Attempt`
- [ ] Snippet de verificação em Node, PHP e Python na documentação — o integrador precisa disso pronto

### Fila e entrega
- [ ] Fila BullMQ `webhook-delivery` com concorrência configurável
- [ ] Timeout por tentativa (`WEBHOOK_TIMEOUT_MS`, default 10s)
- [ ] Sucesso = 2xx; qualquer outra coisa é falha
- [ ] Backoff exponencial **com jitter**: 5s, 30s, 2min, 10min, 1h, 6h (configurável), até `WEBHOOK_MAX_ATTEMPTS`
- [ ] Esgotadas as tentativas → `ABANDONED`, com alerta no painel
- [ ] Desativação automática após `WEBHOOK_FAILURE_THRESHOLD` falhas consecutivas, gravando o motivo
- [ ] Ordem por sessão preservada quando possível (fila com chave de agrupamento)

### Registro
- [ ] `WebhookDelivery` por tentativa: status HTTP, corpo truncado, duração, erro
- [ ] `GET /v1/webhook-endpoints/{id}/deliveries` — paginado, filtro por status
- [ ] `POST /v1/webhook-deliveries/{id}/retry` — reenvio manual
- [ ] Expurgo de entregas antigas (job diário, retenção configurável)

### Payload
- [ ] Envelope próprio e estável, **não** o cru do WAHA:
      `{ id, type, createdAt, application: {id,slug}, session: {id,label,phoneNumber}, data }`
- [ ] Tipos publicados: `message.received`, `message.sent`, `message.ack`, `session.status`, `session.connected`, `session.disconnected`, `ping`
- [ ] Filtro por `events[]` do endpoint; `["*"]` recebe tudo
- [ ] Mídia referenciada pela URL do proxy (`/v1/media/{id}`), nunca pela interna do WAHA

### Testes
- [ ] e2e: mensagem recebida chega ao endpoint com assinatura válida
- [ ] e2e: endpoint que devolve 500 é retentado e a entrega fica registrada
- [ ] e2e: evento da aplicação A não chega ao endpoint da B
- [ ] unit: assinatura verificável pelo snippet publicado
- [ ] unit: replay com timestamp velho é detectável pelo receptor

## Critérios de aceite

```bash
# receptor de teste local
cd apps/api && pnpm ts-node scripts/webhook-receiver.ts &   # escuta em :4444 e valida a assinatura

EP=$(curl -s -XPOST localhost:3001/v1/webhook-endpoints -H "x-api-key: $KEY" \
  -H 'content-type: application/json' \
  -d '{"url":"http://host.docker.internal:4444/hook","events":["*"]}' | jq -r .id)

# ping
curl -s -XPOST localhost:3001/v1/webhook-endpoints/$EP/test -H "x-api-key: $KEY" | jq .
# o receptor imprime: assinatura VÁLIDA, evento "ping"

# evento real: mandar mensagem para o número conectado pelo celular
# o receptor imprime message.received com session.phoneNumber preenchido

# entregas registradas
curl -s "localhost:3001/v1/webhook-endpoints/$EP/deliveries" -H "x-api-key: $KEY" \
  | jq '.data[] | {eventType,status,attempts,responseStatus}'

# retentativa em falha
kill %1                                     # derruba o receptor
curl -s -XPOST localhost:3001/v1/webhook-endpoints/$EP/test -H "x-api-key: $KEY"
sleep 10 && curl -s "localhost:3001/v1/webhook-endpoints/$EP/deliveries?status=RETRYING" -H "x-api-key: $KEY" | jq '.data[0].attempts'   # > 1

pnpm test:e2e -- webhooks-outbound
```

## Notas

_(preencher durante a execução)_
