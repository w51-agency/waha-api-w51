# 02 — Infraestrutura Docker de desenvolvimento

**Status:** ✅ CONCLUÍDA
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
- [x] Bloco de portas do host: `WEB_PORT=8080`, `API_PORT=3001`, `POSTGRES_PORT=5432`, `REDIS_PORT=6379`, `WAHA_PORT=3000`
- [x] `BIND_ADDRESS=127.0.0.1` (documentar que `0.0.0.0` expõe na rede)
- [x] Bloco Postgres: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB=gateway`, `WAHA_POSTGRES_DB=waha`
- [x] URLs internas: `DATABASE_URL`, `REDIS_URL`, `WAHA_BASE_URL=http://waha:3000`, `GATEWAY_INTERNAL_URL=http://api:${API_PORT}`
- [x] Painel: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`
- [x] Segredos: `WAHA_API_KEY`, `WAHA_WEBHOOK_HMAC_KEY`, `API_KEY_PREFIX=wgw_live`
- [x] WAHA: `WHATSAPP_DEFAULT_ENGINE=NOWEB`, `WHATSAPP_RESTART_ALL_SESSIONS=true`, `WAHA_DASHBOARD_ENABLED=false`, `WHATSAPP_SWAGGER_ENABLED=false`, `WAHA_LOG_FORMAT=JSON`, `WAHA_PRINT_QR=true`, `TZ=America/Sao_Paulo`
- [x] Cada bloco comentado em PT-BR explicando o efeito da variável
- [x] `scripts/gen-secrets.sh` gerando valores aleatórios para os segredos e imprimindo o `.env` pronto

### `docker-compose.yml` (dev)
- [x] Serviço `postgres` (imagem `postgres:16-alpine`), volume `pgdata`, healthcheck `pg_isready`
- [x] Script de init criando o segundo database (`waha`) — `docker/postgres/init-databases.sh` montado em `/docker-entrypoint-initdb.d/`
- [x] Serviço `redis` (`redis:7-alpine`), volume `redisdata`, healthcheck `redis-cli ping`
- [x] Serviço `waha` (`devlikeapro/waha`) com `WHATSAPP_DEFAULT_ENGINE=NOWEB`, `WAHA_API_KEY`, `WHATSAPP_SESSIONS_POSTGRESQL_URL` apontando para o database `waha`, `depends_on` com `condition: service_healthy`
- [x] Volumes do WAHA para mídia (`/tmp/whatsapp-files`) e `.sessions` (fallback)
- [x] Healthcheck do WAHA batendo em `/health`
- [x] Rede interna nomeada; **em dev** o WAHA publica porta para depuração, em prod não
- [x] Todos os `ports:` usando interpolação com default — zero literal

### Verificação da regra de portas
- [x] `grep` de portas literais fora de `${...}` não retorna nada em `docker-compose*.yml` e `docker/`
- [x] Subida com portas não-default funciona sem editar arquivo nenhum além do `.env`

### Documentação
- [x] `docs/infraestrutura.md`: o que cada serviço faz, como trocar portas, como zerar o ambiente
- [x] Seção no `README.md` com o passo a passo de subida em dev

## Critérios de aceite

```bash
cp .env.example .env && ./scripts/gen-secrets.sh
docker compose up -d
docker compose ps                       # postgres, redis e waha todos "healthy"

# WAHA responde; /health é liberado de propósito (o healthcheck do Docker
# não deve precisar da chave), mas o resto da API exige
curl -s -o /dev/null -w '%{http_code}\n' localhost:${WAHA_PORT}/health        # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:${WAHA_PORT}/api/sessions  # 401
curl -s localhost:${WAHA_PORT}/api/sessions -H "x-api-key: $WAHA_API_KEY"      # 200

# os dois databases existem
docker compose exec postgres psql -U gateway -lqt | cut -d'|' -f1 | grep -E 'gateway|waha'

# motor NOWEB confirmado em uma sessão de teste
curl -s -XPOST localhost:${WAHA_PORT}/api/sessions -H "x-api-key: $WAHA_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"probe","start":true,"config":{"noweb":{"store":{"enabled":true}}}}' | jq .
docker compose logs waha | grep -i noweb        # motor NOWEB ativo
docker compose logs waha | tail -40             # QR code ASCII aparece no log
curl -s -XDELETE localhost:${WAHA_PORT}/api/sessions/probe -H "x-api-key: $WAHA_API_KEY"
```

**Teste das portas configuráveis:**

```bash
docker compose down
WAHA_PORT=3910 POSTGRES_PORT=5544 REDIS_PORT=6399 docker compose up -d
docker compose ps                                # mapeamentos nas portas novas
curl -s localhost:3910/health -H "x-api-key: $WAHA_API_KEY" | jq .   # responde
docker compose down && docker compose up -d      # volta ao default
```

## Notas

### Decisões

- **Tag `noweb-2026.8.1` em vez de `latest`.** A `latest` embute Chromium (2,97 GB); a
  `noweb` traz só o necessário para o motor NOWEB (2,36 GB). Versão fixada porque `latest`
  muda debaixo dos pés — atualização vira decisão explícita via `WAHA_IMAGE` no `.env`.
- **Sessões do WAHA em Postgres**, não em volume de disco. Entram no mesmo backup do resto
  e sobrevivem à recriação do container. Verificado: recriar o WAHA com portas diferentes
  preservou a sessão em `SCAN_QR_CODE`.
- **Redis com `maxmemory-policy noeviction`.** Ele guarda filas BullMQ e refresh tokens;
  despejar chaves sob pressão de memória perderia entregas de webhook em silêncio.
- **`WHATSAPP_API_KEY_EXCLUDE_PATH=/health`.** Sem isso o healthcheck do Docker precisaria
  carregar a API key. O restante da API continua exigindo a chave (verificado: 401 em
  `/api/sessions`).
- **WAHA publicado só em desenvolvimento.** O compose de produção (tarefa 20) não terá
  `ports:` para ele.

### Problemas encontrados e corrigidos

1. **WAHA em loop de reinício: `The server does not support SSL connections`.** O cliente
   `pg` do WAHA tenta SSL por padrão e o `postgres:16-alpine` não oferece. Resolvido com
   `?sslmode=disable` na `WHATSAPP_SESSIONS_POSTGRESQL_URL` — seguro, o tráfego não sai da
   rede interna do Docker.

2. **Healthcheck nunca convergia (`health: starting` indefinidamente).** Eu havia escrito o
   teste com `wget`, que **não existe** na imagem do WAHA — falhava com exit 127 sem sinal
   visível. A imagem traz `curl`. Trocado.

3. **Comentários inline no `.env` corrompendo valores.** O `gen-secrets.sh` lia
   `POSTGRES_PORT=5432       # Postgres` com `cut -d= -f2-` e produzia
   `DATABASE_URL=...@localhost:5432       # Postgres/gateway`. Corrigido em duas frentes:
   todo comentário no `.env.example` passou para linha própria, **e** o script ganhou um
   `read_var()` que descarta comentário e espaços — assim continua correto se alguém
   reintroduzir um comentário inline.

4. **Porta 3000 já ocupada** por um servidor Next.js do usuário nesta máquina. Serviu como
   validação não planejada da parametrização: bastou `WAHA_PORT=3010` no `.env`. O ambiente
   local ficou nessa porta; o default documentado segue 3000.

### `host.docker.internal` — detalhe que só morderia na tarefa 09

Em desenvolvimento a API roda no host e o WAHA em container, então o webhook precisa de
`http://host.docker.internal:${API_PORT}`. No Linux esse nome não resolve sozinho: o
serviço `waha` declara `extra_hosts: host.docker.internal:host-gateway`. Em produção, com
a API também em container, `GATEWAY_INTERNAL_URL` vira `http://api:${API_PORT}`.

### Verificação executada

```
docker compose ps                    postgres, redis e waha healthy
/health sem chave                    200  (liberado de propósito)
/api/sessions sem chave              401
/api/sessions com chave              200
databases                            gateway, waha
/dashboard                           401  (painel nativo desligado)
sessão de teste                      status SCAN_QR_CODE, engine NOWEB
config.metadata                      aceito e ecoado de volta  <- base da tarefa 09
QR                                   valor obtido + impresso no log
memória                              waha 360 MiB | postgres 59 MiB | redis 4 MiB

portas não-default
  WAHA_PORT=3910 POSTGRES_PORT=5544 REDIS_PORT=6399 docker compose up -d
  -> os três healthy nas portas novas, WAHA respondendo 200,
     sessão preservada (persistência em Postgres confirmada)

grep de porta literal fora de ${...} no compose  -> nenhuma
gen-secrets.sh rodado 2x              md5 do .env idêntico (idempotente)
.env                                  modo 600, fora do git
```
