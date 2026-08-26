# 11 — Envio de mensagens (texto e mídia)

**Status:** ⬜ pendente
**Depende de:** 07, 09, 10
**Habilita:** 12, 13, 18

## Objetivo

Expor os endpoints de envio da API pública — texto e todos os tipos de mídia — com
validação de destinatário, persistência de cada envio atribuída à API key que o disparou,
e tratamento de erro que não deixe o integrador no escuro.

## Contexto

Endpoints do WAHA usados (confirmados na documentação): `sendText`, `sendImage`,
`sendFile`, `sendVoice`, `sendVideo`, `sendLocation`, `sendContactVcard`, `sendSeen`,
`startTyping`, `stopTyping`, `reaction`. Arquivos aceitam `file.url` (remoto) **ou**
`file.data` (base64), sempre com `mimetype` e `filename`.

Diferenças de contrato entre a nossa API e a do WAHA, e o porquê:

- O integrador informa **`sessionId`** (nosso cuid), não o nome interno da sessão no WAHA.
  Isso mantém o WAHA como detalhe de implementação e permite trocá-lo sem quebrar clientes.
- O integrador pode informar **`to: "5511999999999"`** em vez de `chatId`. Normalizamos
  para `@c.us`, aceitando também `@g.us`/`@newsletter` quando vier completo.
- Upload de arquivo aceito por **multipart** além de URL/base64 — é o que a maioria dos
  sistemas tem em mãos.

Riscos tratados aqui:

- **Não retentar envio automaticamente.** Um timeout pode significar "entregue, resposta
  perdida"; retentar duplica a mensagem para o destinatário. O cliente WAHA da tarefa 07 já
  bloqueia isso; aqui o erro vira `Message.status = FAILED` com motivo, e a decisão de
  repetir é do integrador.
- **Chave de idempotência opcional** (`Idempotency-Key`): se o integrador mandar, requisição
  repetida com a mesma chave devolve o resultado original em vez de enviar de novo. É a
  forma segura de ele ter retry sem duplicar.
- **SSRF via `file.url`.** Uma URL apontando para `169.254.169.254` ou `localhost` faria o
  WAHA buscar recurso interno. Validar esquema (http/https), bloquear IPs privados/loopback/
  link-local e limitar tamanho.
- **Sessão precisa estar `WORKING`.** Enviar em sessão desconectada devolve 409 com
  orientação clara, sem tentar o WAHA.

## Checklist

### Endpoints
- [ ] `POST /v1/messages/text` — `{ sessionId, to|chatId, text, linkPreview?, mentions?, replyTo? }`
- [ ] `POST /v1/messages/image` — arquivo por `url`, `base64` ou multipart; `caption?`
- [ ] `POST /v1/messages/file` — documentos, com `filename`
- [ ] `POST /v1/messages/voice` — ogg/opus, com `convert?`
- [ ] `POST /v1/messages/video` — mp4, com `caption?`, `asNote?`, `convert?`
- [ ] `POST /v1/messages/location` — `{ latitude, longitude, title? }`
- [ ] `POST /v1/messages/contact` — vCard
- [ ] `POST /v1/messages/reaction` — `{ messageId, emoji }` (emoji vazio remove)
- [ ] `POST /v1/messages/seen` e `POST /v1/messages/typing` — `{ action: "start"|"stop" }`

### Validação
- [ ] `NormalizeChatIdPipe`: aceita `5511999999999`, `+55 11 99999-9999`, `...@c.us`, `...@g.us`, `...@newsletter`
- [ ] Número sem código de país rejeitado com mensagem explicativa em PT-BR
- [ ] Ownership da sessão validada (404 se de outra aplicação)
- [ ] Sessão não `WORKING` → 409 com o status atual
- [ ] Limite de tamanho por tipo (`MAX_MEDIA_SIZE_MB`, default 16)
- [ ] MIME validado contra o tipo do endpoint; detectar por conteúdo, não confiar só no header
- [ ] Guard anti-SSRF em `file.url`: só http/https, DNS resolvido e IP privado/loopback/link-local bloqueado, `Content-Length` limitado

### Idempotência
- [ ] Header `Idempotency-Key` opcional; chave + applicationId no Redis com TTL de 24h
- [ ] Requisição repetida devolve a resposta original, com `Idempotency-Replayed: true`
- [ ] Requisição concorrente com a mesma chave devolve 409

### Persistência
- [ ] Cria `Message` com `status: QUEUED` **antes** de chamar o WAHA
- [ ] Sucesso → `status: SENT`, grava `wahaId` retornado (é ele que casa com os acks da tarefa 10)
- [ ] Falha → `status: FAILED` e `error` com a mensagem traduzida
- [ ] `sentByApiKeyId` e `applicationId` sempre preenchidos — é a atribuição que o painel usa
- [ ] Mídia enviada por upload é armazenada (ou referenciada) para o painel conseguir exibir depois

### Erros
- [ ] Erros do WAHA traduzidos para PT-BR com orientação acionável (ex.: "Número não possui WhatsApp")
- [ ] Resposta sempre inclui o `id` da mensagem no gateway, mesmo em falha — para o integrador consultar depois
- [ ] Escopo `messages:send` exigido

### Documentação
- [ ] Um exemplo de requisição e resposta por endpoint no Swagger
- [ ] `Idempotency-Key` documentado com o comportamento de replay
- [ ] Formatos de `chatId` explicados na descrição da tag

### Testes
- [ ] e2e: enviar texto persiste com `sentByApiKeyId` correto
- [ ] e2e: sessão de outra aplicação devolve 404
- [ ] e2e: sessão parada devolve 409
- [ ] e2e: mesma `Idempotency-Key` não envia duas vezes
- [ ] unit: normalização de `chatId` cobrindo os formatos aceitos
- [ ] unit: URL apontando para IP privado é bloqueada
- [ ] unit: falha do WAHA grava FAILED e **não** retenta

## Critérios de aceite

```bash
# texto
curl -s -XPOST localhost:3001/v1/messages/text -H "x-api-key: $KEY" \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"to\":\"5511999999999\",\"text\":\"Teste do gateway\"}" | jq .
# chega no celular; resposta traz id e status SENT

# imagem por URL
curl -s -XPOST localhost:3001/v1/messages/image -H "x-api-key: $KEY" \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"to\":\"5511999999999\",\"url\":\"https://picsum.photos/400\",\"caption\":\"ok\"}" | jq .

# arquivo por upload
curl -s -XPOST localhost:3001/v1/messages/file -H "x-api-key: $KEY" \
  -F "sessionId=$SID" -F "to=5511999999999" -F "file=@docs/exemplo.pdf" | jq .

# idempotência
IK=$(uuidgen)
for i in 1 2; do curl -s -XPOST localhost:3001/v1/messages/text -H "x-api-key: $KEY" \
  -H "idempotency-key: $IK" -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"to\":\"5511999999999\",\"text\":\"uma vez só\"}" | jq -r .id; done
# mesmo id nas duas, e uma única mensagem no celular

# SSRF barrado
curl -s -XPOST localhost:3001/v1/messages/image -H "x-api-key: $KEY" \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"to\":\"5511999999999\",\"url\":\"http://169.254.169.254/\"}" | jq .   # 422

# ack chega e promove o status
sleep 5 && curl -s "localhost:3001/v1/messages?sessionId=$SID&limit=1" -H "x-api-key: $KEY" | jq '.data[0] | {status,ack,ackName}'

pnpm test:e2e -- messages
```

## Notas

_(preencher durante a execução)_
