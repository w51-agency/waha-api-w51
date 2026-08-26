# 09 — Sessões e fluxo de QR rastreado

**Status:** ✅ CONCLUÍDA
**Depende de:** 05, 07, 08
**Habilita:** 10, 11, 12, 17

## Objetivo

Implementar o ciclo de vida das sessões de WhatsApp pela API pública, com o **rastreio de
origem** que é o coração do pedido: toda vez que um sistema solicita um QR code, fica
registrado qual sistema é, qual chave pediu, quando pediu — e, quando o QR for escaneado,
a qual número aquilo resultou.

## Contexto

Esta é a tarefa central do projeto. O `.plan/start.md` diz: *"toda vez que um sistema
solicitar um qr code você vai registrando certinho de qual sistema é, e o número."*

A implementação se apoia em um recurso do WAHA que resolve isso com elegância: o
**`config.metadata` da sessão aceita chaves arbitrárias e é devolvido em todo webhook**.
Carimbando a identidade na criação da sessão, cada evento subsequente chega já
identificado — sem tabela de correlação frágil nem dependência de ordem de eventos.

```
POST /v1/sessions  (X-API-Key da aplicação "crm")
   │
   ├─ resolve Application → gera nome "crm--k3n9x2"
   ├─ cria Session local (status STARTING, createdByApiKeyId, createdVia: API)
   └─ POST {waha}/api/sessions
         config.metadata = { application.id, application.slug,
                             gateway.session.id, created.by.apikey }
         config.noweb.store.enabled = true
         config.webhooks = [{ url: GATEWAY_INTERNAL_URL/internal/waha/webhook,
                              events: ["*"], hmac: { key: <segredo por sessão> } }]

GET /v1/sessions/{id}/qr
   ├─ valida ownership (404 se não for da aplicação)
   ├─ qrRequestCount++, lastQrRequestedAt = agora, AuditLog "session.qr.requested"
   └─ proxeia GET {waha}/api/{name}/auth/qr

[usuário escaneia]
   └─ WAHA → webhook session.status=WORKING com me.id e o metadata carimbado
         └─ (tarefa 10) grava phoneNumber, waId, pushName, connectedAt
             ↑ AQUI o vínculo sistema ↔ número se fecha
```

Detalhes que evitam dor depois:

- **Nome da sessão no WAHA** é `{slug}--{nanoid}`. Nunca reutilizar nome de sessão
  excluída (o WAHA pode manter estado residual) e nunca deixar o integrador escolher o
  nome cru — ele escolhe um `label` humano, o nome técnico é gerado.
- **Segredo de HMAC por sessão**, guardado em `Session.webhookSecret`, para que a tarefa 10
  saiba com qual chave verificar cada evento.
- **A reconciliação por cron existe porque webhook se perde.** Se o gateway estiver fora do
  ar no instante em que a sessão conecta, o evento é retentado pelo WAHA — mas se todas as
  tentativas falharem, o estado local fica defasado. Um job periódico compara o status
  local com `GET /api/sessions` e corrige.
- **Excluir a sessão no gateway precisa excluir no WAHA também**, senão sobra sessão órfã
  consumindo memória e mantendo o WhatsApp logado.

## Checklist

### Criação
- [x] `POST /v1/sessions` — `{ label?, metadata? }`; nome técnico gerado `{slug}--{nanoid8}`
- [x] `webhookSecret` aleatório por sessão, persistido
- [x] Config enviada ao WAHA com `metadata` de rastreio, `noweb.store.enabled: true`, `fullSync: false` e o webhook do gateway com retries exponenciais
- [x] `Session` local criada **antes** da chamada ao WAHA, e limpa (ou marcada FAILED) se o WAHA recusar — sem registro fantasma
- [x] Limite de sessões por aplicação configurável (`MAX_SESSIONS_PER_APP`, 0 = ilimitado)
- [x] `label` único por aplicação, se informado

### QR — o registro de origem
- [x] `GET /v1/sessions/{id}/qr?format=image|raw` — default `image` (PNG binário)
- [x] Incrementa `qrRequestCount`, grava `lastQrRequestedAt`
- [x] Grava `AuditLog` `session.qr.requested` com `actorId` = id da API key, IP e user-agent
- [x] Se a sessão não estiver em `SCAN_QR_CODE`, devolve 409 com o status atual e explicação em PT-BR (ex.: "Sessão já conectada")
- [x] `POST /v1/sessions/{id}/pairing-code` — `{ phoneNumber }`, mesma trilha de auditoria
- [x] `Cache-Control: no-store` na resposta do QR

### Ciclo de vida
- [x] `GET /v1/sessions` — só as da aplicação; filtros por status; paginado
- [x] `GET /v1/sessions/{id}` — inclui `phoneNumber`, `pushName`, `status`, `qrRequestCount`, `connectedAt`
- [x] `POST /v1/sessions/{id}/start|stop|restart|logout` — idempotentes
- [x] `DELETE /v1/sessions/{id}` — remove no WAHA e depois localmente; sessão já ausente no WAHA não impede a remoção local
- [x] `PATCH /v1/sessions/{id}` — atualiza apenas `label` e `metadata` do integrador

### Isolamento
- [x] `SessionOwnershipGuard`: sessão de outra aplicação devolve **404**, nunca 403 — não vazar existência
- [x] Todas as consultas filtram por `applicationId` na cláusula `where`, sem exceção
- [x] Painel admin usa serviço separado, sem o filtro

### Reconciliação
- [x] Job (`@nestjs/schedule`) a cada `SESSION_SYNC_INTERVAL` (default 60s) comparando estado local × `GET /api/sessions`
- [x] Divergência corrigida e logada; sessão sumida do WAHA vira `FAILED` com motivo
- [x] Sessão `WORKING` sem `phoneNumber` dispara `GET /api/sessions/{s}/me` para completar o vínculo (rede de segurança do webhook)
- [x] Job com lock no Redis para não duplicar com múltiplas instâncias

### Documentação
- [x] Todos os DTOs com `@ApiProperty`, exemplos e descrições em PT-BR
- [x] `GET /qr` documentado com `produces: image/png` e o caso 409

### Testes
- [x] e2e: criar sessão → WAHA recebe metadata correto (verificar no mock)
- [x] e2e: pedir QR incrementa contador e grava auditoria
- [x] e2e: aplicação B recebe 404 na sessão da aplicação A
- [x] e2e: excluir sessão chama delete no WAHA
- [x] unit: reconciliação corrige status divergente

## Critérios de aceite

```bash
SID=$(curl -s -XPOST localhost:3001/v1/sessions -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{"label":"Comercial"}' | jq -r .id)

# o metadata de rastreio chegou no WAHA
NAME=$(curl -s localhost:3001/v1/sessions/$SID -H "x-api-key: $KEY" | jq -r .name)
curl -s localhost:3000/api/sessions/$NAME -H "x-api-key: $WAHA_API_KEY" | jq '.config.metadata'
# esperado: application.id, application.slug, gateway.session.id, created.by.apikey

# QR + registro de origem
curl -s "localhost:3001/v1/sessions/$SID/qr" -H "x-api-key: $KEY" -o qr.png && file qr.png
curl -s localhost:3001/v1/sessions/$SID -H "x-api-key: $KEY" | jq '{qrRequestCount,lastQrRequestedAt}'
# qrRequestCount = 1

# --- escanear o QR com o celular ---
curl -s localhost:3001/v1/sessions/$SID -H "x-api-key: $KEY" | jq '{status,phoneNumber,pushName,connectedAt}'
# status WORKING e o número preenchido: vínculo sistema ↔ número fechado

# isolamento
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/v1/sessions/$SID -H "x-api-key: $KEY_APP_B"   # 404

pnpm test:e2e -- sessions
```

## Notas

### O rastreio funciona — verificado no WAHA real

Criada uma sessão pelo "Sistema A", a consulta direta ao WAHA mostrou o carimbo intacto:

```
metadata:
  application.id     = cmtama0di0000qqi06mbxqai1
  application.slug   = sistema-a
  gateway.session.id = cmtama0id0008qqi0lgkoc36g
  created.by.apikey  = cmtama0f00004qqi00i16k35b
webhook : http://host.docker.internal:3001/internal/waha/webhook
hmac    : configurado
store   : {enabled: true, fullSync: false}
```

Como o WAHA devolve esse objeto em **todo webhook**, a tarefa 10 recebe cada evento já
sabendo de quem é — sem tabela de correlação nem dependência da ordem de chegada.

Pedir o QR três vezes deixou `qrRequestCount = 3` e três linhas de auditoria numeradas.

### Isolamento: 404, nunca 403

Com a chave do Sistema B, **todas** as operações sobre a sessão do Sistema A devolvem 404 —
`GET`, `/qr`, `/stop`, `DELETE` — e a listagem de B mostra zero sessões. Um 403 confirmaria
que o id existe, permitindo mapear as sessões alheias por tentativa.

### `expiresInSeconds` no corpo do QR

O QR do WhatsApp gira a cada ~20 s. Sem esse campo, o integrador não tem como saber que
precisa renovar, e o usuário acaba lendo um código morto — concluindo que o sistema quebrou.
A resposta também vai com `Cache-Control: no-store`: o QR é credencial de curta duração e
não pode encostar em cache compartilhado.

### Mensagens de conflito que dizem o que fazer

Cada status impossível tem sua orientação, em vez de um "conflito" genérico:

- parada → *"Chame /start antes de solicitar o QR code."*
- já conectada → *"Esta sessão já está conectada ao número X. Para trocar de número, use
  /logout antes."*
- ainda iniciando → *"Tente novamente em alguns segundos."*
- falhou → *"Chame /restart para tentar novamente."*

### Nome técnico gerado, nunca reutilizado

`{slug}--{nanoid8}`, com alfabeto sem caracteres ambíguos (aparece em log e URL). O
integrador escolhe só um `label` humano. Reaproveitar nome de sessão excluída traria de
volta estado residual guardado pelo WAHA.

### Logout limpa o vínculo

Desfaz o pareamento, então `phoneNumber`, `waId`, `pushName` e `connectedAt` são zerados.
Mantê-los daria a impressão, no painel, de que o número continua conectado.

### A reconciliação existe porque webhook se perde

`SessionsSyncService` roda a cada minuto com lock no Redis (sem ele, várias instâncias
fariam o mesmo trabalho e multiplicariam a carga no WAHA). Além de corrigir status
divergentes, ele trata **o caso que mais importa**: sessão `WORKING` sem `phoneNumber`
gravado — sinal de que o webhook de conexão se perdeu. Consulta o `/me` do WAHA e recupera
o vínculo.

Sem essa rede, um gateway fora do ar no instante da conexão perderia o vínculo em silêncio,
e a funcionalidade principal do produto sumiria sem deixar rastro.

Há também `sincronizarStatus` em cada leitura: alinha o status antes de decidir com base
nele, para não recusar uma ação legítima por causa de dado velho.

### Verificação executada

```
criar sessão                   STARTING, engine NOWEB, nome sistema-a--ucevsm33
metadata no WAHA               4 chaves de rastreio + webhook + hmac + store
QR                             SCAN_QR_CODE, PNG 292x292, expiresIn 20s
qrRequestCount                 1 -> 2 -> 3, com lastQrRequestedAt
/qr.png                        Content-Type image/png, Cache-Control no-store

isolamento (chave do Sistema B sobre sessão do A):
  GET / qr / stop / DELETE     404 em todos
  lista do B                   0 sessões

ciclo de vida                  stop -> STOPPED, start -> STARTING, restart -> STARTING
QR com sessão parada           409 com orientação em PT-BR
apelido duplicado              409

auditoria da sessão            session.created, qr.requested x3 (numeradas),
                               stop, start, restart

excluir                        {deleted:true} no gateway e 404 no WAHA
```

### Pendente para a tarefa 10

O vínculo número ↔ sistema só se fecha quando o webhook `session.status = WORKING` chega —
ou quando a reconciliação o recupera. A ingestão é a próxima tarefa.
