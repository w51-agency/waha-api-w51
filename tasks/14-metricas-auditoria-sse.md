# 14 — Métricas, auditoria e SSE

**Status:** ⬜ pendente
**Depende de:** 10, 11
**Habilita:** 17, 18, 19

## Objetivo

Fornecer ao painel os dados agregados que ele exibe (volume, taxa de entrega, saúde das
sessões), consolidar a trilha de auditoria transversal e abrir um canal SSE para
atualização em tempo real — sem polling.

## Contexto

O `.plan/start.md` pede *"um painel onde eu vejo os números conectados e as mensagens
enviadas e tudo mais"*. Esta tarefa produz o back-end desse "tudo mais".

Três decisões que importam:

- **Agregação no banco, não na aplicação.** Contar mensagens carregando registros para o
  Node não escala. As séries saem de `GROUP BY date_trunc(...)` usando os índices da tarefa
  03, com o intervalo limitado por parâmetro.
- **Cache curto (30–60s) nas agregações.** O painel recarrega com frequência e as métricas
  toleram estar alguns segundos defasadas; sem cache, cada abertura de dashboard vira meia
  dúzia de varreduras.
- **SSE, não WebSocket.** O fluxo é unidirecional (servidor → painel), SSE reconecta sozinho
  e atravessa proxy HTTP sem configuração especial. WebSocket seria complexidade sem ganho.
  O caso de uso principal é o QR: enquanto o modal está aberto, o status muda de
  `SCAN_QR_CODE` para `WORKING` e a tela precisa reagir na hora.

## Checklist

### Métricas
- [ ] `GET /admin/metrics/overview` — sessões por status, total conectadas, mensagens hoje/7d/30d, taxa de entrega, endpoints com falha
- [ ] `GET /admin/metrics/messages?granularity=hour|day&from=&to=&applicationId=&sessionId=` — série temporal, entrada e saída separadas
- [ ] `GET /admin/metrics/applications` — ranking por volume, com sessões ativas e última atividade
- [ ] `GET /admin/metrics/sessions` — por sessão: volume, uptime, quedas no período, último status
- [ ] `GET /admin/metrics/delivery` — distribuição de ack (enviado/entregue/lido/falho)
- [ ] Buracos na série preenchidos com zero (gráfico sem lacuna)
- [ ] Intervalo máximo consultável limitado; granularidade validada contra o intervalo
- [ ] Cache no Redis com TTL configurável

### Auditoria
- [ ] `AuditService.record()` reutilizável, chamado por sessões, chaves, aplicações, webhooks e login
- [ ] Interceptor gravando automaticamente as mutações de `/admin/*`
- [ ] `GET /admin/audit-logs` — filtros por `actorType`, `action`, `resourceType`, `resourceId`, período; paginado por cursor
- [ ] `GET /admin/audit-logs/resource/{type}/{id}` — linha do tempo de um recurso
- [ ] Ações padronizadas em `recurso.verbo` (`session.qr.requested`, `apikey.revoked`, ...)
- [ ] Gravação **não bloqueia** a operação principal: falha de auditoria é logada, não propagada
- [ ] Expurgo por retenção configurável (`AUDIT_RETENTION_DAYS`)

### SSE
- [ ] `GET /admin/events` — stream autenticado, com filtro opcional por `sessionId`
- [ ] Autenticação por token: JWT via query string (EventSource não envia header), validado e de vida curta
- [ ] Eventos publicados: `session.status`, `session.connected`, `message.received`, `message.sent`, `webhook.failed`
- [ ] Heartbeat a cada 25s para atravessar timeout de proxy
- [ ] Barramento por Redis pub/sub — funciona com múltiplas instâncias da API
- [ ] Limpeza de conexões ao desconectar; teto de conexões simultâneas
- [ ] `GET /v1/sessions/{id}/events` — versão para o integrador, restrita à própria aplicação

### Testes
- [ ] unit: série preenche zeros e respeita o intervalo
- [ ] unit: falha de auditoria não derruba a operação
- [ ] e2e: mudança de status chega no SSE em menos de 2s
- [ ] e2e: métricas batem com o que foi inserido no seed de teste

## Critérios de aceite

```bash
TOKEN=$(curl -s -XPOST localhost:3001/admin/auth/login -H 'content-type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" | jq -r .accessToken)

curl -s localhost:3001/admin/metrics/overview -H "authorization: Bearer $TOKEN" | jq .
curl -s "localhost:3001/admin/metrics/messages?granularity=day&from=2026-08-01" -H "authorization: Bearer $TOKEN" | jq '.series[0:3]'
curl -s localhost:3001/admin/metrics/applications -H "authorization: Bearer $TOKEN" | jq .

# auditoria registrou o pedido de QR da tarefa 09
curl -s "localhost:3001/admin/audit-logs?action=session.qr.requested" -H "authorization: Bearer $TOKEN" \
  | jq '.data[0] | {action,actorType,actorId,resourceId,createdAt}'

# SSE ao vivo
curl -N "localhost:3001/admin/events?token=$TOKEN" &
curl -s -XPOST localhost:3001/v1/sessions/$SID/restart -H "x-api-key: $KEY"
# o stream imprime session.status em poucos segundos

pnpm test:e2e -- metrics audit sse
```

## Notas

_(preencher durante a execução)_
