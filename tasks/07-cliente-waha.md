# 07 — Cliente WAHA tipado

**Status:** ⬜ pendente
**Depende de:** 04
**Habilita:** 09, 10, 11, 12

## Objetivo

Encapsular toda a comunicação com o WAHA em um módulo único e tipado. Nenhuma outra parte
do código faz HTTP para o WAHA diretamente — tudo passa por aqui, com retry, timeout,
tradução de erro e tipos gerados à mão a partir da documentação oficial.

## Contexto

Concentrar o acesso ao WAHA em um único ponto paga por três motivos: os erros do WAHA
viram erros do nosso domínio em um lugar só; trocar de versão do WAHA (ou mockar em
teste) mexe em um arquivo; e o `X-Api-Key` interno nunca vaza para o resto do código.

Contrato relevante do WAHA (confirmado na documentação oficial):

- Autenticação: header `X-Api-Key`, valor de `WAHA_API_KEY`.
- Sessões: `POST /api/sessions`, `GET /api/sessions`, `GET /api/sessions/{s}`,
  `PUT /api/sessions/{s}`, `POST /api/sessions/{s}/{start|stop|restart|logout}`,
  `DELETE /api/sessions/{s}`, `GET /api/sessions/{s}/me`.
- Auth: `GET /api/{s}/auth/qr?format=image|raw`, `POST /api/{s}/auth/request-code`.
- Envio: `POST /api/sendText|sendImage|sendFile|sendVoice|sendVideo|sendLocation|sendContactVcard|sendSeen|startTyping|stopTyping|reaction`.
- Status possíveis: `STOPPED`, `STARTING`, `SCAN_QR_CODE`, `PASSKEY_REQUIRED`,
  `PASSKEY_CONFIRMATION_REQUIRED`, `WORKING`, `FAILED`.
- `chatId`: `5511999999999@c.us` (individual), `...@g.us` (grupo), `...@newsletter` (canal).
- Arquivos: `file.url` (remoto) **ou** `file.data` (base64), com `mimetype` e `filename`.

**Cuidado com retry:** só é seguro repetir automaticamente operações idempotentes
(GET, start/stop). **Envio de mensagem não é retentado às cegas** — um timeout pode
significar "entregue mas resposta perdida", e retentar duplica a mensagem para o
destinatário. Envio faz no máximo retry em erro de conexão antes de qualquer byte ser
enviado, e o resto vira falha explícita.

## Checklist

### Módulo e transporte
- [ ] `WahaModule` global exportando `WahaClient`
- [ ] `undici` com `Agent` de keep-alive e pool configurado
- [ ] Base URL de `WAHA_BASE_URL`; `X-Api-Key` injetado em todo request
- [ ] Timeouts separados por classe de operação (`WAHA_TIMEOUT_MS` default 15s; envio de mídia maior)
- [ ] Log de cada chamada em nível debug: método, caminho, status, duração — **sem corpo de mídia**

### Tipos
- [ ] `packages/shared/src/waha/` com tipos de sessão, config, QR, mensagem, envelope de evento
- [ ] `WahaSessionStatus` como union type alinhado 1:1 com o enum do Prisma
- [ ] Tipos do envelope de webhook: `id`, `timestamp`, `event`, `session`, `metadata`, `me`, `payload`, `engine`, `environment`

### Métodos — sessões
- [ ] `createSession(dto)`, `listSessions(all?)`, `getSession(name)`, `updateSession(name, config)`
- [ ] `startSession`, `stopSession`, `restartSession`, `logoutSession`, `deleteSession`
- [ ] `getMe(name)` — retorna `{ id, pushName }`

### Métodos — auth
- [ ] `getQr(name, format)` — devolve buffer PNG ou o valor cru
- [ ] `requestPairingCode(name, phoneNumber)`

### Métodos — envio
- [ ] `sendText`, `sendImage`, `sendFile`, `sendVoice`, `sendVideo`, `sendLocation`, `sendContactVcard`
- [ ] `sendSeen`, `startTyping`, `stopTyping`, `setReaction`

### Métodos — leitura
- [ ] `getChats(session, paginação)`, `getChatMessages(session, chatId, limit)`
- [ ] `checkNumberExists(session, phone)`
- [ ] `downloadMedia(url)` — stream, para o proxy da tarefa 12

### Resiliência
- [ ] Retry com backoff exponencial + jitter **apenas** em GET e em erro de conexão (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`) e 5xx
- [ ] **Envio nunca é retentado após o corpo ter sido transmitido** — comentar o porquê no código
- [ ] 4xx do WAHA nunca é retentado
- [ ] Tradução de erro: 404 → `WahaSessionNotFoundError`, 422 → `WahaValidationError`, 401 → `WahaAuthError`, 5xx/timeout → `WahaUnavailableError`
- [ ] Cada erro traduzido carrega o corpo original do WAHA em `cause` para depuração
- [ ] `healthCheck()` usado pelo `/health/ready`

### Testes
- [ ] Unit com `undici` MockAgent: sucesso, 404, 422, 5xx, timeout
- [ ] Teste provando que envio **não** é retentado em timeout de resposta
- [ ] Teste provando que GET é retentado e converge

## Critérios de aceite

```bash
pnpm test -- waha-client                     # unit tests passando

# smoke real contra o WAHA de dev
cd apps/api && pnpm ts-node scripts/waha-smoke.ts
# esperado: lista sessões, cria "smoke", lê status SCAN_QR_CODE, busca QR, apaga a sessão

curl -s localhost:3001/health/ready | jq '.details.waha'    # "up"

# WAHA fora do ar degrada com clareza
docker compose stop waha
curl -s localhost:3001/health/ready | jq .                  # 503 apontando waha
docker compose start waha
```

## Notas

_(preencher durante a execução)_
