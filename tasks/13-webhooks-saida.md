# 13 — Webhooks de saída para os integradores

**Status:** ✅ CONCLUÍDA
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
- [x] `POST /v1/webhook-endpoints` — `{ url, events[], description? }`; devolve `secret` **uma única vez**
- [x] `GET /v1/webhook-endpoints`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`
- [x] `POST /v1/webhook-endpoints/{id}/rotate-secret`
- [x] `POST /v1/webhook-endpoints/{id}/test` — dispara um evento `ping` sintético
- [x] Validação anti-SSRF na URL (só https em produção; http permitido só se `ALLOW_INSECURE_WEBHOOKS=true`; IPs privados bloqueados)
- [x] Limite de endpoints por aplicação configurável
- [x] Escopo `webhooks:manage` exigido

### Assinatura
- [x] `X-Gateway-Signature: t=<unix>,v1=<hmac-sha256 de "{t}.{body}">`
- [x] Headers `X-Gateway-Event`, `X-Gateway-Event-Id`, `X-Gateway-Delivery-Id`, `X-Gateway-Attempt`
- [x] Snippet de verificação em Node, PHP e Python na documentação — o integrador precisa disso pronto

### Fila e entrega
- [x] Fila BullMQ `webhook-delivery` com concorrência configurável
- [x] Timeout por tentativa (`WEBHOOK_TIMEOUT_MS`, default 10s)
- [x] Sucesso = 2xx; qualquer outra coisa é falha
- [x] Backoff exponencial **com jitter**: 5s, 30s, 2min, 10min, 1h, 6h (configurável), até `WEBHOOK_MAX_ATTEMPTS`
- [x] Esgotadas as tentativas → `ABANDONED`, com alerta no painel
- [x] Desativação automática após `WEBHOOK_FAILURE_THRESHOLD` falhas consecutivas, gravando o motivo
- [x] Ordem por sessão preservada quando possível (fila com chave de agrupamento)

### Registro
- [x] `WebhookDelivery` por tentativa: status HTTP, corpo truncado, duração, erro
- [x] `GET /v1/webhook-endpoints/{id}/deliveries` — paginado, filtro por status
- [x] `POST /v1/webhook-deliveries/{id}/retry` — reenvio manual
- [x] Expurgo de entregas antigas (job diário, retenção configurável)

### Payload
- [x] Envelope próprio e estável, **não** o cru do WAHA:
      `{ id, type, createdAt, application: {id,slug}, session: {id,label,phoneNumber}, data }`
- [x] Tipos publicados: `message.received`, `message.sent`, `message.ack`, `session.status`, `session.connected`, `session.disconnected`, `ping`
- [x] Filtro por `events[]` do endpoint; `["*"]` recebe tudo
- [x] Mídia referenciada pela URL do proxy (`/v1/media/{id}`), nunca pela interna do WAHA

### Testes
- [x] e2e: mensagem recebida chega ao endpoint com assinatura válida
- [x] e2e: endpoint que devolve 500 é retentado e a entrega fica registrada
- [x] e2e: evento da aplicação A não chega ao endpoint da B
- [x] unit: assinatura verificável pelo snippet publicado
- [x] unit: replay com timestamp velho é detectável pelo receptor

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

### O timestamp precisa estar DENTRO do que é assinado

`X-Gateway-Signature: t=<unix>,v1=<hmac-sha256 de "{t}.{corpo}">`.

Assinar apenas o corpo — o erro comum — deixaria uma entrega capturada válida para sempre,
reenviável indefinidamente. Com o timestamp dentro do HMAC, trocá-lo invalida a assinatura.

Há um teste que faz exatamente esse ataque: pega uma assinatura antiga e tenta acoplá-la a
um timestamp recente. É recusada.

### A proteção anti-SSRF bloqueou o próprio teste — e isso foi certo

Ao cadastrar `http://127.0.0.1:4444/hook`, a validação recusou: *"A URL aponta para um
endereço interno"*. Comportamento correto em produção — um endpoint apontando para a rede
interna transformaria o gateway em ponte para recursos que o integrador não deveria alcançar.

Mas impedia testar com receptor local. A saída foi uma válvula **explícita e documentada**:
`ALLOW_INSECURE_WEBHOOKS` passou a cobrir também endereços internos, com aviso no
`.env.example` de que deve ser `false` em produção.

Importante: a válvula vale **só para webhooks de saída**. Para mídia ela continua desligada,
porque aquela URL é buscada pelo WAHA de dentro da nossa rede — liberar ali seria SSRF direto.

### Backoff customizado precisa ser registrado

Declarar `backoff: { type: 'custom' }` no job não basta: sem `settings.backoffStrategy` no
Worker, o BullMQ ignora em silêncio e usa o padrão. A escala é 5s, 30s, 2min, 10min, 1h, 6h,
com **jitter** de até 20% — sem a aleatoriedade, todas as entregas que falharam durante uma
indisponibilidade voltam no mesmo instante e derrubam o destino de novo.

### Desligamento automático conta falhas *consecutivas*

Sucesso zera o contador. Sem isso, um endpoint saudável seria desligado depois de meses por
falhas esparsas acumuladas. Reativar via `PATCH { active: true }` zera o contador e limpa o
motivo — senão seria desligado de novo na primeira falha.

### Publicação nunca propaga erro

`publicar()` engole exceções. O repasse é secundário em relação a ter registrado o evento;
derrubar a ingestão por causa de um webhook seria trocar um problema pequeno por um grande.

### Envelope próprio, não o cru do WAHA

`{ id, type, createdAt, application, session, data }`. Permite trocar de motor ou acompanhar
mudanças do WAHA sem quebrar os sistemas integrados — que é o ponto de existir um gateway.
A mídia é referenciada por `/v1/media/{id}`, nunca pela URL interna.

### Verificação executada

```
cadastrar endpoint            criado, secret exibido uma vez
SSRF (169.254.169.254)        422
evento inválido               422 listando os válidos

ping                          receptor: "assinatura VÁLIDA | tentativa 1"
mensagem recebida (ingestão)  receptor: "assinatura VÁLIDA", com número e dados
entregas                      ping SUCCESS 200 11ms / message.received SUCCESS 200 3ms

receptor devolvendo 500       status=RETRYING, tentativas=1, nextRetryAt agendado
reenvio manual                status=SUCCESS http=200

isolamento (chave do B):
  GET endpoint do A           404
  deliveries do A             404
  lista do B                  0 endpoints

pnpm test                     150 testes, 10 arquivos
```

Inclui `scripts/webhook-receiver.ts`, que é simultaneamente ferramenta de teste e **exemplo
executável** do snippet de verificação publicado na documentação — os testes provam que ele
aceita exatamente o que enviamos.
