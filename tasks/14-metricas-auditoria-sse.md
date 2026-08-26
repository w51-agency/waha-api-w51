# 14 — Métricas, auditoria e SSE

**Status:** ✅ CONCLUÍDA
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
- [x] `GET /admin/metrics/overview` — sessões por status, total conectadas, mensagens hoje/7d/30d, taxa de entrega, endpoints com falha
- [x] `GET /admin/metrics/messages?granularity=hour|day&from=&to=&applicationId=&sessionId=` — série temporal, entrada e saída separadas
- [x] `GET /admin/metrics/applications` — ranking por volume, com sessões ativas e última atividade
- [x] `GET /admin/metrics/sessions` — por sessão: volume, uptime, quedas no período, último status
- [x] `GET /admin/metrics/delivery` — distribuição de ack (enviado/entregue/lido/falho)
- [x] Buracos na série preenchidos com zero (gráfico sem lacuna)
- [x] Intervalo máximo consultável limitado; granularidade validada contra o intervalo
- [x] Cache no Redis com TTL configurável

### Auditoria
- [x] `AuditService.record()` reutilizável, chamado por sessões, chaves, aplicações, webhooks e login
- [x] Interceptor gravando automaticamente as mutações de `/admin/*`
- [x] `GET /admin/audit-logs` — filtros por `actorType`, `action`, `resourceType`, `resourceId`, período; paginado por cursor
- [x] `GET /admin/audit-logs/resource/{type}/{id}` — linha do tempo de um recurso
- [x] Ações padronizadas em `recurso.verbo` (`session.qr.requested`, `apikey.revoked`, ...)
- [x] Gravação **não bloqueia** a operação principal: falha de auditoria é logada, não propagada
- [x] Expurgo por retenção configurável (`AUDIT_RETENTION_DAYS`)

### SSE
- [x] `GET /admin/events` — stream autenticado, com filtro opcional por `sessionId`
- [x] Autenticação por token: JWT via query string (EventSource não envia header), validado e de vida curta
- [x] Eventos publicados: `session.status`, `session.connected`, `message.received`, `message.sent`, `webhook.failed`
- [x] Heartbeat a cada 25s para atravessar timeout de proxy
- [x] Barramento por Redis pub/sub — funciona com múltiplas instâncias da API
- [x] Limpeza de conexões ao desconectar; teto de conexões simultâneas
- [x] `GET /v1/sessions/{id}/events` — versão para o integrador, restrita à própria aplicação

### Testes
- [x] unit: série preenche zeros e respeita o intervalo
- [x] unit: falha de auditoria não derruba a operação
- [x] e2e: mudança de status chega no SSE em menos de 2s
- [x] e2e: métricas batem com o que foi inserido no seed de teste

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

### Redis pub/sub, não Subject em memória

O barramento de eventos usa pub/sub do Redis. Um `Subject` local funcionaria perfeitamente
em desenvolvimento e falharia em silêncio ao escalar: com duas instâncias da API, um evento
processado na instância A nunca chegaria ao painel conectado à instância B. É o pior tipo de
bug — aparece só em produção, e como intermitência.

O ioredis exige **conexão dedicada** para subscribe: uma conexão em modo assinante não
aceita outros comandos, e a principal serve cache e filas.

### Token na query string do SSE — limitação da especificação

A API `EventSource` do navegador **não permite headers customizados**. Não é escolha nossa;
é a especificação. Mitigado pela vida curta do access token (15 min) e por a conexão ser
sempre local ao painel.

Sem token, o `verifyAsync` lançava o erro cru do JWT e virava **500** — o painel não
conseguiria distinguir "preciso renovar" de "o servidor quebrou". Passou a devolver 401 com
`type: invalid-token`.

### Heartbeat a cada 25s

Proxies encerram conexões ociosas em 30–60s. Sem o batimento, o painel ficaria com um stream
morto sem que ninguém percebesse — pior que uma desconexão explícita, que ao menos dispara
reconexão. Verificado: 1 batimento em 28s de escuta.

### Séries preenchidas com zero

Um gráfico com lacunas sugere falha de coleta; zeros explícitos dizem "não houve tráfego".
Verificado com 7 dias: 8 pontos, sete deles zerados e o último com 42 mensagens.

### Intervalo limitado por granularidade

Granularidade horária em um ano geraria ~8 760 pontos — gráfico ilegível e consulta pesada.
Teto de 7 dias para `hour` e 365 para `day`, com mensagem explicando o limite.

### Taxa de entrega devolve `null`, não zero

Sem envios no período, `0%` seria enganoso (sugere que tudo falhou) e `100%` também.
`null` diz "não há dados", e o painel decide como exibir.

### Descrição da auditoria montada na leitura

Guardamos `recurso.verbo` + metadados para poder filtrar; a frase legível é construída na
consulta. Assim, melhorar o texto não exige reescrever histórico — e ele é imutável por
natureza.

Login **e tentativa recusada** são auditados: uma sequência de recusas é o sinal de que
alguém está tentando entrar.

### Verificação executada

```
/admin/metrics/overview        sessões por status, mensagens (hoje/7d/30d),
                               taxa de entrega, alertas
série temporal 7 dias          8 pontos, sem lacunas
hour com 8 meses               422 "o intervalo máximo é de 7 dias"
por aplicação                  ordenado por volume
auditoria                      descrições em PT-BR ("Sessão "Ingestao" criada por
                               sistema-a/k", "QR code solicitado por ... (2ª vez)")
linha do tempo do recurso      histórico ordenado de uma sessão

SSE:
  sem token / token lixo       401 com type invalid-token
  com token válido             recebeu session.status e message.received ao vivo,
                               poucos segundos após os eventos
  heartbeat                    1 batimento em 28s

pnpm test                      150 testes
```
