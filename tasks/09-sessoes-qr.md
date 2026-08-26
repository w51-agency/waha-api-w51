# 09 — Sessões e fluxo de QR rastreado

**Status:** ⬜ pendente
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
- [ ] `POST /v1/sessions` — `{ label?, metadata? }`; nome técnico gerado `{slug}--{nanoid8}`
- [ ] `webhookSecret` aleatório por sessão, persistido
- [ ] Config enviada ao WAHA com `metadata` de rastreio, `noweb.store.enabled: true`, `fullSync: false` e o webhook do gateway com retries exponenciais
- [ ] `Session` local criada **antes** da chamada ao WAHA, e limpa (ou marcada FAILED) se o WAHA recusar — sem registro fantasma
- [ ] Limite de sessões por aplicação configurável (`MAX_SESSIONS_PER_APP`, 0 = ilimitado)
- [ ] `label` único por aplicação, se informado

### QR — o registro de origem
- [ ] `GET /v1/sessions/{id}/qr?format=image|raw` — default `image` (PNG binário)
- [ ] Incrementa `qrRequestCount`, grava `lastQrRequestedAt`
- [ ] Grava `AuditLog` `session.qr.requested` com `actorId` = id da API key, IP e user-agent
- [ ] Se a sessão não estiver em `SCAN_QR_CODE`, devolve 409 com o status atual e explicação em PT-BR (ex.: "Sessão já conectada")
- [ ] `POST /v1/sessions/{id}/pairing-code` — `{ phoneNumber }`, mesma trilha de auditoria
- [ ] `Cache-Control: no-store` na resposta do QR

### Ciclo de vida
- [ ] `GET /v1/sessions` — só as da aplicação; filtros por status; paginado
- [ ] `GET /v1/sessions/{id}` — inclui `phoneNumber`, `pushName`, `status`, `qrRequestCount`, `connectedAt`
- [ ] `POST /v1/sessions/{id}/start|stop|restart|logout` — idempotentes
- [ ] `DELETE /v1/sessions/{id}` — remove no WAHA e depois localmente; sessão já ausente no WAHA não impede a remoção local
- [ ] `PATCH /v1/sessions/{id}` — atualiza apenas `label` e `metadata` do integrador

### Isolamento
- [ ] `SessionOwnershipGuard`: sessão de outra aplicação devolve **404**, nunca 403 — não vazar existência
- [ ] Todas as consultas filtram por `applicationId` na cláusula `where`, sem exceção
- [ ] Painel admin usa serviço separado, sem o filtro

### Reconciliação
- [ ] Job (`@nestjs/schedule`) a cada `SESSION_SYNC_INTERVAL` (default 60s) comparando estado local × `GET /api/sessions`
- [ ] Divergência corrigida e logada; sessão sumida do WAHA vira `FAILED` com motivo
- [ ] Sessão `WORKING` sem `phoneNumber` dispara `GET /api/sessions/{s}/me` para completar o vínculo (rede de segurança do webhook)
- [ ] Job com lock no Redis para não duplicar com múltiplas instâncias

### Documentação
- [ ] Todos os DTOs com `@ApiProperty`, exemplos e descrições em PT-BR
- [ ] `GET /qr` documentado com `produces: image/png` e o caso 409

### Testes
- [ ] e2e: criar sessão → WAHA recebe metadata correto (verificar no mock)
- [ ] e2e: pedir QR incrementa contador e grava auditoria
- [ ] e2e: aplicação B recebe 404 na sessão da aplicação A
- [ ] e2e: excluir sessão chama delete no WAHA
- [ ] unit: reconciliação corrige status divergente

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

_(preencher durante a execução)_
