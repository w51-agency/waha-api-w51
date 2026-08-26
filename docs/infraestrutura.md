# Infraestrutura

Ambiente de desenvolvimento em três containers, orquestrados por `docker-compose.yml`.
A API e o painel rodam no host (`pnpm dev`) para ter hot reload; em produção eles também
viram containers (ver `docs/deploy.md`).

```
        host                                 rede docker "gateway"
  ┌───────────────┐                     ┌──────────────────────────────┐
  │  pnpm dev     │  localhost:3010     │  waha        :3000  (NOWEB)  │
  │  api  :3001   │ ──────────────────▶ │                              │
  │  web  :5173   │                     │  postgres    :5432           │
  │               │ ◀────────────────── │    ├── gateway   (nosso)     │
  └───────────────┘  host.docker.internal│    └── waha      (sessões)  │
        webhooks                        │  redis       :6379           │
                                        └──────────────────────────────┘
```

## Serviços

| Serviço | Imagem | Para que serve |
|---|---|---|
| `waha` | `devlikeapro/waha:noweb-2026.8.1` | Fala com o WhatsApp pelo motor NOWEB |
| `postgres` | `postgres:16-alpine` | Dois databases: `gateway` e `waha` |
| `redis` | `redis:7-alpine` | Filas BullMQ, cache de API key e rate limit |

### Por que a tag `noweb`

O WAHA publica variantes por motor. A `latest` embute Chromium para o motor WEBJS e ocupa
2,97 GB; a `noweb` traz só o necessário para o motor NOWEB e ocupa 2,36 GB. Como o projeto
usa exclusivamente NOWEB, a variante enxuta é a correta.

Medição real com uma sessão em `SCAN_QR_CODE`:

```
w51-waha       360 MiB     0,09% CPU
w51-postgres    59 MiB
w51-redis        4 MiB
```

Para comparação, o motor WEBJS carrega um Chromium por sessão e costuma passar de 1 GB.

**A versão é fixada de propósito.** `latest` muda debaixo dos pés e transforma um
`docker compose pull` de rotina em incidente de produção. Para atualizar, troque
`WAHA_IMAGE` no `.env`, teste, e só então promova.

## Portas — a regra

**Nenhuma porta literal fora de interpolação.** Todo mapeamento no compose tem a forma:

```yaml
ports:
  - '${BIND_ADDRESS:-127.0.0.1}:${WAHA_PORT:-3000}:3000'
```

O que distingue os dois lados:

- **Porta do host** (`${WAHA_PORT}`) — como *você* alcança o serviço da sua máquina. Muda
  livremente pelo `.env`.
- **Porta interna** (`3000`) — como os *outros containers* alcançam o serviço, sempre por
  nome de serviço (`waha:3000`, `postgres:5432`, `redis:6379`). É fixa de propósito: se
  mudasse junto, trocar a porta do host quebraria a comunicação interna.

A única exceção é o gateway, que escuta de fato em `${API_PORT}` — por isso o
`GATEWAY_INTERNAL_URL` acompanha.

Para trocar qualquer porta:

```bash
sed -i 's/^WAHA_PORT=.*/WAHA_PORT=3910/' .env
./scripts/gen-secrets.sh     # re-sincroniza as URLs derivadas
docker compose up -d
```

Ou, para um teste pontual, sem tocar em arquivo:

```bash
WAHA_PORT=3910 POSTGRES_PORT=5544 REDIS_PORT=6399 docker compose up -d
```

`BIND_ADDRESS` controla quem enxerga: `127.0.0.1` (padrão) restringe à própria máquina;
`0.0.0.0` expõe na rede local.

## Persistência

As sessões do WhatsApp ficam em **Postgres**, não em volume de disco
(`WHATSAPP_SESSIONS_POSTGRESQL_URL`). Isso as coloca no mesmo backup do resto do sistema e
faz com que sobrevivam à recriação do container sem cuidado especial com bind mount —
verificado: recriar o container com portas diferentes preservou a sessão ativa.

Volumes:

| Volume | Conteúdo |
|---|---|
| `pgdata` | Dados do Postgres (inclui as sessões do WAHA) |
| `redisdata` | AOF do Redis — filas e refresh tokens |
| `wahamedia` | Mídia baixada, servida ao integrador via proxy do gateway |
| `wahasessions` | Fallback de sessão em disco (pouco usado com Postgres ativo) |

O Redis roda com `maxmemory-policy noeviction` de propósito: ele guarda filas de webhook e
refresh tokens. Despejar chaves sob pressão de memória perderia entregas em silêncio —
falhar a escrita e alertar é preferível a perder trabalho sem ninguém notar.

## Segurança do WAHA

- **API key obrigatória** em tudo, exceto `/health` — liberado por
  `WHATSAPP_API_KEY_EXCLUDE_PATH` para que o healthcheck do Docker não precise da chave.
  Verificado: `/api/sessions` sem chave devolve 401.
- **Painel e Swagger nativos desligados** (`WAHA_DASHBOARD_ENABLED=false`,
  `WHATSAPP_SWAGGER_ENABLED=false`) — temos os nossos, e deixá-los ligados é superfície de
  ataque a mais.
- **Publicado só em desenvolvimento.** Em produção o WAHA não tem `ports:`: só existe na
  rede interna, e todo acesso passa pelo gateway.

## Zerando o ambiente

```bash
docker compose down -v      # apaga TODOS os volumes: sessões, mensagens, tudo
docker compose up -d
```

Sessões de WhatsApp conectadas serão perdidas e os números precisarão escanear o QR de novo.

## Armadilhas já resolvidas

Registrado aqui porque cada uma custou um ciclo de depuração:

- **`sslmode=disable` na URL do WAHA.** O cliente `pg` do WAHA tenta SSL por padrão; o
  Postgres da imagem alpine não oferece. Sem o parâmetro, o WAHA entra em loop de reinício
  com `The server does not support SSL connections`. É seguro: o tráfego não sai da rede
  interna do Docker.
- **Healthcheck com `curl`, não `wget`.** A imagem do WAHA traz `curl`; `wget` não existe,
  e o healthcheck falha silenciosamente com exit 127, deixando o container eternamente
  em `health: starting`.
- **`host.docker.internal` via `extra_hosts`.** Em desenvolvimento a API roda no host e o
  WAHA precisa alcançá-la para entregar webhooks. No Linux esse nome não resolve sozinho:
  o compose declara `host.docker.internal:host-gateway`. Em produção, com a API em
  container, `GATEWAY_INTERNAL_URL` vira `http://api:${API_PORT}`.
- **Comentários inline no `.env`.** O Docker Compose os remove, mas scripts de shell e
  alguns parsers levam o comentário junto do valor — `PORT=3000  # comentário` vira o valor
  literal `3000  # comentário`. Por isso todo comentário no `.env.example` fica em linha
  própria, e o `gen-secrets.sh` ainda assim os descarta na leitura.
