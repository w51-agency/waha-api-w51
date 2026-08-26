# 02 — Infraestrutura Docker de desenvolvimento

**Status:** ⬜ pendente
**Depende de:** 01
**Habilita:** 03, 04, 07

## Objetivo

Subir a infraestrutura local completa via `docker compose`: **WAHA no motor NOWEB**,
Postgres (com dois databases) e Redis — com **todas as portas parametrizadas no `.env`**.
Ao final, `docker compose up -d` deve deixar os três serviços saudáveis e o WAHA
imprimindo QR code no log.

## Contexto

O WAHA é a peça que fala com o WhatsApp. O motor **NOWEB** conversa por WebSocket
(Baileys) em vez de rodar Chromium — é o "esquema que não usa browser" pedido no
`.plan/start.md`, e consome uma fração da memória do WEBJS.

Dois pontos que exigem atenção:

1. **NOWEB precisa do store habilitado** (`config.noweb.store.enabled = true`) para dar
   acesso a chats, contatos e histórico. Isso é configurado por sessão (tarefa 09), mas
   o comportamento precisa ser entendido aqui.
2. **Desde a versão 2026.6.1 o WAHA é 100% gratuito e open source** — não existe mais a
   divisão Core/Plus. Usar a imagem `devlikeapro/waha`; não há licença nem credencial
   de registry a configurar.

### Regra de ouro das portas

**Nenhuma porta literal fora de interpolação.** Todo mapeamento no compose usa
`"${BIND_ADDRESS:-127.0.0.1}:${X_PORT:-N}:N"`. As variáveis `*_PORT` controlam **apenas
o lado do host**; entre containers o acesso é sempre por nome de serviço + porta interna
fixa (`postgres:5432`, `redis:6379`, `waha:3000`), que não muda nunca. O gateway é a
única exceção: ele escuta de fato em `${API_PORT}`.

## Checklist

### `.env.example`
- [ ] Bloco de portas do host: `WEB_PORT=8080`, `API_PORT=3001`, `POSTGRES_PORT=5432`, `REDIS_PORT=6379`, `WAHA_PORT=3000`
- [ ] `BIND_ADDRESS=127.0.0.1` (documentar que `0.0.0.0` expõe na rede)
- [ ] Bloco Postgres: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB=gateway`, `WAHA_POSTGRES_DB=waha`
- [ ] URLs internas: `DATABASE_URL`, `REDIS_URL`, `WAHA_BASE_URL=http://waha:3000`, `GATEWAY_INTERNAL_URL=http://api:${API_PORT}`
- [ ] Painel: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`
- [ ] Segredos: `WAHA_API_KEY`, `WAHA_WEBHOOK_HMAC_KEY`, `API_KEY_PREFIX=wgw_live`
- [ ] WAHA: `WHATSAPP_DEFAULT_ENGINE=NOWEB`, `WHATSAPP_RESTART_ALL_SESSIONS=true`, `WAHA_DASHBOARD_ENABLED=false`, `WHATSAPP_SWAGGER_ENABLED=false`, `WAHA_LOG_FORMAT=JSON`, `WAHA_PRINT_QR=true`, `TZ=America/Sao_Paulo`
- [ ] Cada bloco comentado em PT-BR explicando o efeito da variável
- [ ] `scripts/gen-secrets.sh` gerando valores aleatórios para os segredos e imprimindo o `.env` pronto

### `docker-compose.yml` (dev)
- [ ] Serviço `postgres` (imagem `postgres:16-alpine`), volume `pgdata`, healthcheck `pg_isready`
- [ ] Script de init criando o segundo database (`waha`) — `docker/postgres/init-databases.sh` montado em `/docker-entrypoint-initdb.d/`
- [ ] Serviço `redis` (`redis:7-alpine`), volume `redisdata`, healthcheck `redis-cli ping`
- [ ] Serviço `waha` (`devlikeapro/waha`) com `WHATSAPP_DEFAULT_ENGINE=NOWEB`, `WAHA_API_KEY`, `WHATSAPP_SESSIONS_POSTGRESQL_URL` apontando para o database `waha`, `depends_on` com `condition: service_healthy`
- [ ] Volumes do WAHA para mídia (`/tmp/whatsapp-files`) e `.sessions` (fallback)
- [ ] Healthcheck do WAHA batendo em `/health`
- [ ] Rede interna nomeada; **em dev** o WAHA publica porta para depuração, em prod não
- [ ] Todos os `ports:` usando interpolação com default — zero literal

### Verificação da regra de portas
- [ ] `grep` de portas literais fora de `${...}` não retorna nada em `docker-compose*.yml` e `docker/`
- [ ] Subida com portas não-default funciona sem editar arquivo nenhum além do `.env`

### Documentação
- [ ] `docs/infraestrutura.md`: o que cada serviço faz, como trocar portas, como zerar o ambiente
- [ ] Seção no `README.md` com o passo a passo de subida em dev

## Critérios de aceite

```bash
cp .env.example .env && ./scripts/gen-secrets.sh
docker compose up -d
docker compose ps                       # postgres, redis e waha todos "healthy"

# WAHA responde e exige a API key
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/health          # 401
curl -s localhost:3000/health -H "x-api-key: $WAHA_API_KEY" | jq .      # 200, status ok

# os dois databases existem
docker compose exec postgres psql -U gateway -lqt | cut -d'|' -f1 | grep -E 'gateway|waha'

# motor NOWEB confirmado em uma sessão de teste
curl -s -XPOST localhost:3000/api/sessions -H "x-api-key: $WAHA_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"probe","start":true,"config":{"noweb":{"store":{"enabled":true}}}}' | jq .
docker compose logs waha | grep -i noweb        # motor NOWEB ativo
docker compose logs waha | tail -40             # QR code ASCII aparece no log
curl -s -XDELETE localhost:3000/api/sessions/probe -H "x-api-key: $WAHA_API_KEY"
```

**Teste das portas configuráveis:**

```bash
docker compose down
WAHA_PORT=3900 POSTGRES_PORT=5544 REDIS_PORT=6399 docker compose up -d
docker compose ps                                # mapeamentos nas portas novas
curl -s localhost:3900/health -H "x-api-key: $WAHA_API_KEY" | jq .   # responde
docker compose down && docker compose up -d      # volta ao default
```

## Notas

_(preencher durante a execução)_
