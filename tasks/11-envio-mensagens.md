# 11 — Envio de mensagens (texto e mídia)

**Status:** ✅ CONCLUÍDA
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
- [x] `POST /v1/messages/text` — `{ sessionId, to|chatId, text, linkPreview?, mentions?, replyTo? }`
- [x] `POST /v1/messages/image` — arquivo por `url`, `base64` ou multipart; `caption?`
- [x] `POST /v1/messages/file` — documentos, com `filename`
- [x] `POST /v1/messages/voice` — ogg/opus, com `convert?`
- [x] `POST /v1/messages/video` — mp4, com `caption?`, `asNote?`, `convert?`
- [x] `POST /v1/messages/location` — `{ latitude, longitude, title? }`
- [x] `POST /v1/messages/contact` — vCard
- [x] `POST /v1/messages/reaction` — `{ messageId, emoji }` (emoji vazio remove)
- [x] `POST /v1/messages/seen` e `POST /v1/messages/typing` — `{ action: "start"|"stop" }`

### Validação
- [x] `NormalizeChatIdPipe`: aceita `5511999999999`, `+55 11 99999-9999`, `...@c.us`, `...@g.us`, `...@newsletter`
- [x] Número sem código de país rejeitado com mensagem explicativa em PT-BR
- [x] Ownership da sessão validada (404 se de outra aplicação)
- [x] Sessão não `WORKING` → 409 com o status atual
- [x] Limite de tamanho por tipo (`MAX_MEDIA_SIZE_MB`, default 16)
- [x] MIME validado contra o tipo do endpoint; detectar por conteúdo, não confiar só no header
- [x] Guard anti-SSRF em `file.url`: só http/https, DNS resolvido e IP privado/loopback/link-local bloqueado, `Content-Length` limitado

### Idempotência
- [x] Header `Idempotency-Key` opcional; chave + applicationId no Redis com TTL de 24h
- [x] Requisição repetida devolve a resposta original, com `Idempotency-Replayed: true`
- [x] Requisição concorrente com a mesma chave devolve 409

### Persistência
- [x] Cria `Message` com `status: QUEUED` **antes** de chamar o WAHA
- [x] Sucesso → `status: SENT`, grava `wahaId` retornado (é ele que casa com os acks da tarefa 10)
- [x] Falha → `status: FAILED` e `error` com a mensagem traduzida
- [x] `sentByApiKeyId` e `applicationId` sempre preenchidos — é a atribuição que o painel usa
- [x] Mídia enviada por upload é armazenada (ou referenciada) para o painel conseguir exibir depois

### Erros
- [x] Erros do WAHA traduzidos para PT-BR com orientação acionável (ex.: "Número não possui WhatsApp")
- [x] Resposta sempre inclui o `id` da mensagem no gateway, mesmo em falha — para o integrador consultar depois
- [x] Escopo `messages:send` exigido

### Documentação
- [x] Um exemplo de requisição e resposta por endpoint no Swagger
- [x] `Idempotency-Key` documentado com o comportamento de replay
- [x] Formatos de `chatId` explicados na descrição da tag

### Testes
- [x] e2e: enviar texto persiste com `sentByApiKeyId` correto
- [x] e2e: sessão de outra aplicação devolve 404
- [x] e2e: sessão parada devolve 409
- [x] e2e: mesma `Idempotency-Key` não envia duas vezes
- [x] unit: normalização de `chatId` cobrindo os formatos aceitos
- [x] unit: URL apontando para IP privado é bloqueada
- [x] unit: falha do WAHA grava FAILED e **não** retenta

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

### A idempotência estava com a semântica errada — corrigida

A primeira versão liberava a chave em **qualquer** falha, para o integrador poder corrigir e
repetir. Isso derruba exatamente a proteção que a idempotência existe para dar: se a falha
foi um **timeout**, a entrega ficou em aberto — pode ter chegado com a resposta perdida — e
liberar a chave permite que o retry duplique a mensagem no aparelho do destinatário.

A regra passou a distinguir:

- **Não-entrega certa** (4xx do gateway: validação, sessão desconectada, destinatário
  inválido) → libera. Nada saiu; o cliente corrige e repete com a mesma chave.
- **Entrega incerta** (timeout, 408, 429, erro de conexão) → **retém**. Repetir arriscaria
  duplicar.

Há testes para as duas semânticas. Este é o par necessário da decisão da tarefa 07 de não
retentar envios automaticamente: sem idempotência com essa distinção, o integrador que sofre
um timeout não tem saída segura.

### Proteção contra SSRF — verificada nas várias formas

`file.url` vem de fora e é buscada pelo WAHA, que roda **dentro da nossa rede**. A validação
resolve o DNS antes de aprovar, porque checar só o texto da URL deixaria passar um domínio
apontando para IP privado. Bloqueados e testados:

```
169.254.169.254   metadados de instância em nuvem
localhost         resolve para ::1
127.x, 10.x, 192.168.x, 172.16-31.x, 100.64.x (CGNAT), 0.x
IPv6: ::1, fd00::, fe80::
file://, ftp://, gopher://
```

### Mensagens de erro do WAHA traduzidas

O WAHA responde em inglês e de forma lacônica: *"Session status is not as expected"*. Como
isso chega direto ao integrador, foi traduzido **com o que fazer**:

> A sessão não está conectada (sessão "sistema-a--898w8zja"). Verifique o status em
> GET /v1/sessions/{id} e escaneie o QR code se necessário.

Também traduzidos: número sem WhatsApp, chatId inválido, arquivo grande demais, formato não
aceito, limite de envio do WhatsApp.

### "property X should not exist" também estava em inglês

É o erro mais frequente de integração — basta digitar um campo errado. Agora:
*"O campo "sessonId" não é reconhecido. Verifique a grafia na documentação em /docs."*

### Registrar antes de enviar

A mensagem é gravada como `QUEUED` **antes** da chamada ao WAHA. Se o processo cair no meio,
fica o registro do que foi tentado em vez de um envio invisível. Se o WAHA recusar, vira
`FAILED` com o motivo e o `sentByApiKeyId` — o integrador investiga pelo id, mesmo em erro.

### Três origens de arquivo, exatamente uma por vez

`url`, `base64` ou upload multipart. Zero origens e duas origens têm mensagens distintas —
"envie de uma destas formas" e "envie por apenas uma origem" — porque são enganos diferentes.

### Verificação executada

```
sessão desconectada          409 com orientação (não erro obscuro)
isolamento (chave do B)      404
número sem código do país    422 "tem apenas 9 dígitos... para o Brasil, algo como 5511999999999"

SSRF:
  169.254.169.254            422 endereço interno
  localhost                  422 resolve para ::1
  192.168.1.1                422 endereço interno
  file://                    422 protocolo não aceito

arquivo sem origem           409
duas origens                 409
base64 de 17MB (teto 16MB)   422 "17.0 MB, acima do limite de 16.0 MB"
campo desconhecido           422 em PT-BR

erro do WAHA                 traduzido com orientação
registro FAILED              motivo + sentByApiKeyId preenchidos

pnpm test                    129 testes, 8 arquivos
```

### Não verificado nesta tarefa

O envio bem-sucedido de ponta a ponta exige um número real conectado por QR. Toda a lógica
até a chamada ao WAHA está coberta; o envio real é o marco manual de validação do sistema.
