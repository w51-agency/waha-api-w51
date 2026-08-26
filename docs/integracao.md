# Guia de integração

Como conectar o seu sistema ao WhatsApp Gateway W51, do zero à primeira mensagem.

Tudo aqui é reproduzível: copie, cole, ajuste a URL e a chave.

---

## O que você precisa

Uma **API key**, emitida pelo administrador do gateway no painel. Ela tem esta cara:

```
wgw_live_a1b2c3d4e5f6_9fK2xQ7mNp4vR8sT1uW3yZ5aB6cD0eF
```

Guarde-a como guardaria uma senha: ela dá acesso a enviar mensagens em nome dos números
que a sua aplicação conectar. Se vazar, peça a revogação — o efeito é imediato.

Ao longo deste guia:

```bash
export GATEWAY=http://localhost:3001
export API_KEY=wgw_live_a1b2c3d4e5f6_seu-segredo
```

---

## 1. Confirme a credencial

Antes de qualquer coisa, confirme que a chave funciona e veja o que ela permite:

```bash
curl -s $GATEWAY/v1/me -H "x-api-key: $API_KEY"
```

```json
{
  "application": { "id": "clx...", "name": "CRM Vendas", "slug": "crm-vendas" },
  "apiKey": { "id": "clx...", "name": "produção", "prefix": "wgw_live_a1b2c3d4e5f6" },
  "scopes": [
    { "scope": "messages:send", "description": "Enviar mensagens" }
  ]
}
```

Se vier **401**, a chave está errada, revogada ou a aplicação foi desativada — não
distinguimos os casos na resposta.

---

## 2. Crie uma sessão

Uma **sessão** é um número de WhatsApp conectado. Cada sessão pertence à sua aplicação: você
não enxerga nem opera sessões de outros sistemas.

```bash
curl -s -XPOST $GATEWAY/v1/sessions \
  -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' \
  -d '{"label":"Comercial"}'
```

```json
{
  "id": "clx1a2b3c4d5",
  "label": "Comercial",
  "status": "STARTING",
  "statusLabel": "Iniciando",
  "phoneNumber": null,
  "qrRequestCount": 0
}
```

Guarde o `id` — é ele que você usa em todo o resto.

O `label` é seu, para identificar o número depois. O nome técnico da sessão é gerado por nós.

---

## 3. Conecte o número pelo QR code

Aguarde a sessão sair de `STARTING` (poucos segundos) e busque o QR:

```bash
curl -s "$GATEWAY/v1/sessions/$SESSION_ID/qr" -H "x-api-key: $API_KEY"
```

```json
{
  "value": "https://wa.me/settings/linked_devices#2@ABC...",
  "imageBase64": "iVBORw0KGgo...",
  "status": "SCAN_QR_CODE",
  "expiresInSeconds": 20
}
```

Renderize `value` como QR code, ou use `imageBase64` direto:

```html
<img src="data:image/png;base64,{imageBase64}" alt="QR code" />
```

Prefere a imagem crua? `GET /v1/sessions/{id}/qr.png` devolve o PNG.

> ### O QR expira em ~20 segundos
>
> É o WhatsApp que gira o código, não nós. **Busque um novo antes de expirar** — o campo
> `expiresInSeconds` diz a janela. Sem isso, o usuário escaneia um código morto e conclui
> que o seu sistema está quebrado.
>
> Na prática: um `setInterval` de 18 segundos buscando o QR de novo, até o status virar
> `WORKING`.

O usuário escaneia em **WhatsApp → Aparelhos conectados → Conectar aparelho**.

### Alternativa: código de pareamento

Se preferir não exibir QR:

```bash
curl -s -XPOST "$GATEWAY/v1/sessions/$SESSION_ID/pairing-code" \
  -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"phoneNumber":"5511999999999"}'
```

Devolve um código de 8 dígitos que o usuário digita no celular.

---

## 4. Saiba quando conectou

Três formas, da melhor para a mais simples:

**Webhook** (recomendado) — cadastre um endpoint e receba `session.connected`. Veja a
seção 7.

**Server-Sent Events** — abra um stream e receba a mudança no instante em que acontece:

```javascript
const stream = new EventSource(
  `${GATEWAY}/v1/sessions/${sessionId}/events?token=${apiKey}`
);

stream.addEventListener('session.status', (evento) => {
  const { data } = JSON.parse(evento.data);
  if (data.status === 'WORKING') {
    console.log('Conectado ao número', data.phoneNumber);
    stream.close();
  }
});
```

**Consulta periódica** — a cada 3 segundos:

```bash
curl -s "$GATEWAY/v1/sessions/$SESSION_ID" -H "x-api-key: $API_KEY"
```

Quando conectar:

```json
{
  "status": "WORKING",
  "statusLabel": "Conectado",
  "phoneNumber": "5511988887777",
  "pushName": "Comercial da Empresa",
  "connectedAt": "2026-08-26T21:44:00.783Z"
}
```

---

## 5. Envie mensagens

### Texto

```bash
curl -s -XPOST $GATEWAY/v1/messages/text \
  -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "sessionId": "'$SESSION_ID'",
    "to": "5511999999999",
    "text": "Olá! Seu pedido foi confirmado."
  }'
```

```json
{
  "id": "clx9h8g7f6e5",
  "wahaId": "true_5511999999999@c.us_ABCD1234",
  "status": "SENT",
  "chatId": "5511999999999@c.us",
  "timestamp": "2026-08-26T21:45:00.000Z",
  "error": null
}
```

### O formato do destinatário

O campo `to` aceita o número de várias formas — normalizamos:

| Você envia | Vira |
|---|---|
| `5511999999999` | `5511999999999@c.us` |
| `+55 (11) 99999-9999` | `5511999999999@c.us` |
| `5511999999999@c.us` | inalterado |
| `120363012345678901@g.us` | inalterado (grupo) |

**Sempre inclua o código do país.** `999999999` é recusado com explicação: sem o DDI, o
WhatsApp interpretaria o número como de outro país.

### Mídia

Três formas de mandar o arquivo — escolha uma:

```bash
# por URL pública
curl -s -XPOST $GATEWAY/v1/messages/image \
  -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"sessionId":"'$SESSION_ID'","to":"5511999999999",
       "url":"https://exemplo.com/comprovante.jpg","caption":"Seu comprovante"}'

# por upload
curl -s -XPOST $GATEWAY/v1/messages/file \
  -H "x-api-key: $API_KEY" \
  -F "sessionId=$SESSION_ID" -F "to=5511999999999" \
  -F "file=@./nota-fiscal.pdf"

# por base64
curl -s -XPOST $GATEWAY/v1/messages/image \
  -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"sessionId":"'$SESSION_ID'","to":"5511999999999",
       "base64":"iVBORw0KGgo...","mimetype":"image/png"}'
```

Endpoints: `/image`, `/file`, `/voice`, `/video`, `/location`, `/contact`, `/reaction`,
`/seen`, `/typing`.

Para áudio e vídeo fora do formato que o WhatsApp aceita, mande `"convert": true`.

> **URLs internas são recusadas.** `localhost`, `10.x`, `192.168.x`, `169.254.169.254` e
> similares devolvem 422. É proteção contra SSRF — a URL é buscada de dentro da nossa rede.

---

## 6. Repetir envios com segurança

**Não retentamos envios automaticamente.** Um tempo esgotado pode significar "entregue,
resposta perdida" — repetir duplicaria a mensagem no aparelho do destinatário.

Para ter retry seguro, mande um `Idempotency-Key`:

```bash
IK=$(uuidgen)

curl -s -XPOST $GATEWAY/v1/messages/text \
  -H "x-api-key: $API_KEY" \
  -H "idempotency-key: $IK" \
  -H 'content-type: application/json' \
  -d '{"sessionId":"'$SESSION_ID'","to":"5511999999999","text":"Enviada uma vez só"}'
```

Repetir com a mesma chave devolve o resultado original e o header
`Idempotency-Replayed: true`, sem enviar de novo. A chave vale 24 horas.

Como isso se comporta em cada tipo de falha:

| Situação | A chave é liberada? | O que fazer |
|---|---|---|
| Erro de validação, sessão desconectada (4xx) | **Sim** | Corrija e repita com a mesma chave |
| Tempo esgotado, erro de conexão | **Não** | A entrega ficou em aberto; consulte antes de repetir |
| Limite de requisições (429) | **Não** | Aguarde o `Retry-After` |

A retenção nos casos incertos é deliberada: é ela que impede a duplicação.

---

## 7. Receba mensagens por webhook

Cadastre a URL do seu sistema:

```bash
curl -s -XPOST $GATEWAY/v1/webhook-endpoints \
  -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"url":"https://seu-sistema.com/webhooks/whatsapp","events":["*"]}'
```

```json
{
  "id": "clx...",
  "url": "https://seu-sistema.com/webhooks/whatsapp",
  "events": ["*"],
  "secret": "HsBs1uywbBQzInrfDkV5JgAbC...",
  "warning": "Guarde este segredo agora — ele não será exibido novamente."
}
```

**Copie o `secret` agora.** Ele não é recuperável; se perder, use `/rotate-secret`.

### Eventos disponíveis

| Evento | Quando |
|---|---|
| `message.received` | Chegou uma mensagem |
| `message.sent` | Uma mensagem sua saiu |
| `message.ack` | Confirmação de entrega ou leitura |
| `session.connected` | Um número conectou |
| `session.disconnected` | Um número caiu |
| `session.status` | Qualquer mudança de estado |
| `ping` | Teste manual |

### O que chega

```json
{
  "id": "gev_1a2b3c4d...",
  "type": "message.received",
  "createdAt": "2026-08-26T21:50:00.000Z",
  "application": { "id": "clx...", "slug": "crm-vendas" },
  "session": { "id": "clx...", "label": "Comercial", "phoneNumber": "5511988887777" },
  "data": {
    "id": "clx...",
    "chatId": "5511977776666@c.us",
    "type": "text",
    "body": "Bom dia, gostaria de saber sobre meu pedido",
    "mediaUrl": null,
    "timestamp": "2026-08-26T21:50:00.000Z"
  }
}
```

Headers:

```
X-Gateway-Signature: t=1787770200,v1=a3f5...
X-Gateway-Event: message.received
X-Gateway-Event-Id: gev_1a2b3c4d...
X-Gateway-Delivery-Id: clx...
X-Gateway-Attempt: 1
```

### Verifique a assinatura

**Sempre verifique.** Sem isso, qualquer um que descubra a sua URL pode injetar eventos
falsos no seu sistema.

O HMAC-SHA256 cobre `"{timestamp}.{corpo bruto}"` — o timestamp entra no que é assinado
justamente para você poder recusar entregas antigas sem que alguém consiga forjar um
timestamp novo.

**Node.js**

```javascript
import { createHmac, timingSafeEqual } from 'node:crypto';

function verificar(corpoBruto, header, segredo, toleranciaSegundos = 300) {
  const partes = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...r] = p.trim().split('=');
      return [k, r.join('=')];
    })
  );

  const timestamp = Number(partes.t);
  if (!Number.isFinite(timestamp)) return false;

  // Recusa entregas antigas: barra o reenvio de uma requisição capturada.
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranciaSegundos) return false;

  const esperada = createHmac('sha256', segredo)
    .update(`${timestamp}.${corpoBruto}`)
    .digest('hex');

  const a = Buffer.from(esperada);
  const b = Buffer.from(partes.v1 ?? '');

  return a.length === b.length && timingSafeEqual(a, b);
}
```

> **Use o corpo bruto**, não o objeto já parseado. Reserializar o JSON muda a ordem das
> chaves e o espaçamento, e a assimatura deixa de bater. No Express:
> `express.raw({ type: 'application/json' })`.

**PHP**

```php
function verificar(string $corpoBruto, string $header, string $segredo, int $tolerancia = 300): bool {
    $partes = [];
    foreach (explode(',', $header) as $par) {
        [$k, $v] = array_pad(explode('=', trim($par), 2), 2, '');
        $partes[$k] = $v;
    }

    $timestamp = (int) ($partes['t'] ?? 0);
    if ($timestamp === 0 || abs(time() - $timestamp) > $tolerancia) {
        return false;
    }

    $esperada = hash_hmac('sha256', $timestamp . '.' . $corpoBruto, $segredo);

    return hash_equals($esperada, $partes['v1'] ?? '');
}

// $corpoBruto = file_get_contents('php://input');
```

**Python**

```python
import hmac, hashlib, time

def verificar(corpo_bruto: bytes, header: str, segredo: str, tolerancia: int = 300) -> bool:
    partes = dict(p.strip().split("=", 1) for p in header.split(","))

    try:
        timestamp = int(partes["t"])
    except (KeyError, ValueError):
        return False

    if abs(time.time() - timestamp) > tolerancia:
        return False

    esperada = hmac.new(
        segredo.encode(),
        f"{timestamp}.".encode() + corpo_bruto,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(esperada, partes.get("v1", ""))
```

### Regras do seu endpoint

- **Responda 2xx rapidamente.** Processe de forma assíncrona do seu lado. Entregas que
  demoram mais que o tempo limite são retentadas.
- **Trate reentregas.** Use o `id` do envelope para descartar duplicatas — a mesma entrega
  pode chegar mais de uma vez.
- Falhas são retentadas com espera crescente: 5s, 30s, 2min, 10min, 1h, 6h.
- Após muitas falhas seguidas, o endpoint é **desativado automaticamente**. Você reativa em
  `PATCH /v1/webhook-endpoints/{id}` com `{"active": true}`.

### Teste antes de depender

```bash
curl -s -XPOST "$GATEWAY/v1/webhook-endpoints/$ENDPOINT_ID/test" -H "x-api-key: $API_KEY"
```

Dispara um `ping`. Depois confira o resultado:

```bash
curl -s "$GATEWAY/v1/webhook-endpoints/$ENDPOINT_ID/deliveries" -H "x-api-key: $API_KEY"
```

---

## 8. Consulte o histórico

```bash
curl -s "$GATEWAY/v1/messages?sessionId=$SESSION_ID&limit=20" -H "x-api-key: $API_KEY"
```

```json
{
  "data": [ ... ],
  "nextCursor": "MjAyNi0wOC0yNlQyMTo0NTowMC4wMDBafGNseDE=",
  "hasMore": true
}
```

### Paginação

Passe o `nextCursor` em `?cursor=` para a próxima página. Quando vier `null`, acabou:

```javascript
let cursor = null;
const todas = [];

do {
  const url = new URL(`${GATEWAY}/v1/messages`);
  url.searchParams.set('limit', '100');
  if (cursor) url.searchParams.set('cursor', cursor);

  const r = await fetch(url, { headers: { 'x-api-key': API_KEY } });
  const pagina = await r.json();

  todas.push(...pagina.data);
  cursor = pagina.nextCursor;
} while (cursor);
```

Usamos cursor, não offset: cursor não repete nem pula registros quando chegam mensagens
novas durante a navegação. **Não tente interpretar o cursor** — o formato é interno e pode
mudar.

Filtros: `sessionId`, `chatId`, `direction`, `status`, `type`, `from`, `to`, `search`.

### Baixar mídia

O campo `mediaUrl` das mensagens aponta para o nosso proxy:

```bash
curl -s "$GATEWAY/v1/media/$MESSAGE_ID" -H "x-api-key: $API_KEY" -o arquivo.jpg
```

Exige a sua chave. Arquivos ficam disponíveis por tempo limitado após o recebimento.

---

## Erros

Todos no mesmo formato:

```json
{
  "type": "https://gateway.w51/errors/session-not-working",
  "title": "Sessão não conectada",
  "status": 409,
  "detail": "A sessão ainda não foi conectada. Escaneie o QR code em GET /v1/sessions/{id}/qr.",
  "instance": "/v1/messages/text",
  "requestId": "01JCQ8Z5X9K2M4N6P8R0T2V4W6"
}
```

Trate pelo `type`, que é estável. Mostre o `detail` ao usuário. **Registre o `requestId`** —
é por ele que localizamos o log da sua requisição.

### Os mais comuns

| Status | `type` | O que fazer |
|---|---|---|
| 401 | `missing-api-key`, `unauthorized` | Confira o header `X-API-Key` |
| 403 | `missing-scope` | A chave não tem o escopo; peça outra |
| 404 | `session-not-found` | O id não existe **ou é de outra aplicação** |
| 409 | `session-not-working` | Conecte o número antes de enviar |
| 409 | `qr-unavailable` | A sessão não está aguardando QR — veja o status |
| 413 | `payload-too-large` | Arquivo acima do limite |
| 422 | `validation-failed` | Veja o campo `errors` |
| 429 | `throttler-exception` | Aguarde o `Retry-After` |
| 503 | `waha-unavailable` | Serviço de WhatsApp instável; tente de novo |

---

## Boas práticas

**Trate `404` como "não é meu".** Sessões de outras aplicações respondem 404, não 403 — de
propósito, para não confirmar que o id existe.

**Verifique o número antes de enviar em massa.**

```bash
curl -s "$GATEWAY/v1/sessions/$SESSION_ID/contacts/check?phone=5511999999999" \
  -H "x-api-key: $API_KEY"
```

Evita registrar falhas que dava para prever.

**Trate a desconexão.** Números caem: o usuário desvincula o aparelho, troca de celular,
fica muito tempo sem internet. Escute `session.disconnected` e avise quem precisa reconectar.

**Não guarde a chave no código-fonte.** Variável de ambiente ou cofre de segredos.

**Respeite o limite de requisições.** Os headers `X-RateLimit-Remaining` dizem quanto resta;
não espere o 429 para desacelerar.

---

## Referência completa

A especificação OpenAPI navegável está em `/docs`, com "Try it out" funcional — cole a sua
chave no botão **Authorize** e teste direto do navegador.

O arquivo bruto está em [`openapi.json`](openapi.json), pronto para gerar client em qualquer
linguagem.
