# 07 — Cliente WAHA tipado

**Status:** ✅ CONCLUÍDA
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
- [x] `WahaModule` global exportando `WahaClient`
- [x] `undici` com `Agent` de keep-alive e pool configurado
- [x] Base URL de `WAHA_BASE_URL`; `X-Api-Key` injetado em todo request
- [x] Timeouts separados por classe de operação (`WAHA_TIMEOUT_MS` default 15s; envio de mídia maior)
- [x] Log de cada chamada em nível debug: método, caminho, status, duração — **sem corpo de mídia**

### Tipos
- [x] `packages/shared/src/waha/` com tipos de sessão, config, QR, mensagem, envelope de evento
- [x] `WahaSessionStatus` como union type alinhado 1:1 com o enum do Prisma
- [x] Tipos do envelope de webhook: `id`, `timestamp`, `event`, `session`, `metadata`, `me`, `payload`, `engine`, `environment`

### Métodos — sessões
- [x] `createSession(dto)`, `listSessions(all?)`, `getSession(name)`, `updateSession(name, config)`
- [x] `startSession`, `stopSession`, `restartSession`, `logoutSession`, `deleteSession`
- [x] `getMe(name)` — retorna `{ id, pushName }`

### Métodos — auth
- [x] `getQr(name, format)` — devolve buffer PNG ou o valor cru
- [x] `requestPairingCode(name, phoneNumber)`

### Métodos — envio
- [x] `sendText`, `sendImage`, `sendFile`, `sendVoice`, `sendVideo`, `sendLocation`, `sendContactVcard`
- [x] `sendSeen`, `startTyping`, `stopTyping`, `setReaction`

### Métodos — leitura
- [x] `getChats(session, paginação)`, `getChatMessages(session, chatId, limit)`
- [x] `checkNumberExists(session, phone)`
- [x] `downloadMedia(url)` — stream, para o proxy da tarefa 12

### Resiliência
- [x] Retry com backoff exponencial + jitter **apenas** em GET e em erro de conexão (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`) e 5xx
- [x] **Envio nunca é retentado após o corpo ter sido transmitido** — comentar o porquê no código
- [x] 4xx do WAHA nunca é retentado
- [x] Tradução de erro: 404 → `WahaSessionNotFoundError`, 422 → `WahaValidationError`, 401 → `WahaAuthError`, 5xx/timeout → `WahaUnavailableError`
- [x] Cada erro traduzido carrega o corpo original do WAHA em `cause` para depuração
- [x] `healthCheck()` usado pelo `/health/ready`

### Testes
- [x] Unit com `undici` MockAgent: sucesso, 404, 422, 5xx, timeout
- [x] Teste provando que envio **não** é retentado em timeout de resposta
- [x] Teste provando que GET é retentado e converge

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

### Retentativa: a distinção que evita mensagem duplicada

`retryable` é **opt-in por chamada**, não o padrão. GET, start/stop/restart/logout e delete
são idempotentes e retentam até 3 vezes com backoff exponencial + jitter. **Nenhum método de
envio retenta.**

O motivo está comentado no código: um timeout ao enviar pode significar "entregue, resposta
perdida". Repetir duplicaria a mensagem no aparelho do destinatário — dano visível e
irreversível. Ali a falha é explícita, e a decisão de repetir fica com o integrador, com
chave de idempotência (tarefa 11).

Há um teste que conta as chamadas e falha se o envio for retentado.

O jitter no backoff não é enfeite: sem ele, todas as chamadas que falharam juntas voltam
juntas quando o serviço se recupera, e o derrubam de novo.

### Health check migrado para o cliente

O `HealthService` tinha um `fetch` manual para o WAHA. Agora usa `waha.healthCheck()`, que
não retenta de propósito — a sonda precisa de resposta rápida e binária; um retry atrasaria
além do timeout do orquestrador e provocaria o reinício que ela deveria evitar.

### Smoke real, além dos unitários

`scripts/waha-smoke.ts` exercita o WAHA de verdade. Os testes unitários dublam o transporte
(MockAgent do undici) e provam a lógica; o smoke prova que o **contrato tipado corresponde ao
que o WAHA realmente devolve** — que é onde tipos escritos à mão a partir de documentação
costumam errar.

Confirmado na execução: `config.metadata` volta **intacto** na consulta da sessão. É a base
do rastreio de origem da tarefa 09.

### O pacote shared passou a emitir CommonJS

Ao ganhar um subdiretório (), o `shared` quebrou: com `"type": "module"`, o
TypeScript emite `export * from './waha/types'` sem extensão, e o Node ESM exige `.js`
explícito. O erro só aparece em tempo de execução — `build` e `typecheck` passavam.

Resolvido emitindo CommonJS. O consumidor principal é o NestJS, que é CJS; o Vite
(`apps/web`) pré-empacota dependências CJS sem atrito, então não custa nada do outro lado.

### O pacote shared passou a emitir CommonJS

Ao ganhar um subdiretório (`waha/types`), o `shared` quebrou: com `"type": "module"`, o
TypeScript emite o re-export sem extensão, e o Node ESM exige `.js` explícito. O erro só
aparecia em tempo de execução — `build` e `typecheck` seguiam verdes, e foi o `pnpm smoke`
que o pegou.

Resolvido emitindo CommonJS. O consumidor principal é o NestJS, que é CJS; o Vite
(`apps/web`) pré-empacota dependências CJS sem atrito, então não custa nada do outro lado.

### Verificação executada

```
pnpm test                        67 testes, 4 arquivos

smoke real contra o WAHA:
  health check                   no ar
  criar sessão                   STARTING, engine NOWEB
  aguardar                       SCAN_QR_CODE
  QR bruto                       https://wa.me/settings/linked_devices#2@...
  QR imagem                      5395 bytes, cabeçalho PNG válido
  metadata                       {"application.id":"smoke","gateway.session.id":"teste"}
  sessão inexistente             WahaSessionNotFoundError, mensagem em PT-BR
  excluir                        removida

testes de retentativa:
  GET em 5xx                     repete e converge
  envio em 5xx                   1 chamada apenas  <- o comportamento crítico
  4xx                            1 chamada apenas
```
