# WhatsApp Gateway W51

Gateway multi-sistema de WhatsApp construído sobre o [WAHA](https://waha.devlike.pro/) no
motor **NOWEB** — que fala com o WhatsApp por WebSocket, sem Chromium, usando cerca de
360 MB de memória em vez de mais de 1 GB.

O projeto **não é** um fork do WAHA: é uma camada de gateway na frente dele. O WAHA fica em
rede interna, sem exposição pública, e todo acesso externo passa por esta API — que
autentica, autoriza, registra e repassa.

---

## O que ele resolve

Vários sistemas precisam mandar mensagem por WhatsApp. Cada um conecta os próprios números,
e você precisa saber quem conectou o quê.

- **API documentada em Swagger**, para os sistemas consumirem.
- **API keys por sistema integrador**, com isolamento real: cada chave enxerga e opera
  apenas as sessões da própria aplicação — as de outros respondem 404.
- **Rastreio de origem do QR code.** Cada solicitação registra qual sistema pediu, qual
  chave, quando; e ao conectar, a qual número aquilo resultou.
- **Painel** com números conectados em tempo real, histórico de mensagens, métricas e
  trilha de auditoria.
- **Webhooks de saída** assinados, com retentativas e histórico de entregas.

---

## Arquitetura

```
                      ┌─────────────────────────────────────────┐
  Sistema externo ──▶ │  Gateway API (NestJS)                   │
    X-API-Key         │  /v1/*      API pública (API key)       │
                      │  /admin/*   painel (JWT)                │
                      │  /docs      Swagger                     │
                      │  /internal/waha/webhook  (HMAC-SHA512)  │
                      └──┬──────────────┬──────────────┬────────┘
                         │              │              │
                    ┌────▼───┐   ┌──────▼────┐   ┌─────▼────┐
                    │Postgres│   │   Redis   │   │   WAHA   │
                    │gateway │   │  BullMQ   │   │  NOWEB   │
                    │ waha   │   │  cache    │   │          │
                    └────────┘   └───────────┘   └──────────┘
                         ▲
                  ┌──────┴──────────────┐
                  │ Painel React (nginx)│ ← único serviço publicado
                  └─────────────────────┘
```

**O mecanismo central de rastreio:** ao criar uma sessão, carimbamos a identidade da
aplicação no `config.metadata` do WAHA. Ele devolve esse objeto em **todo webhook** — então
cada evento chega já identificado, sem tabela de correlação nem dependência de ordem.

| Camada | Tecnologia |
|---|---|
| API | NestJS 11 · Prisma 7 · PostgreSQL 16 · Swagger |
| Painel | React 19 · Vite · Tailwind 4 |
| Filas | BullMQ · Redis 7 |
| WhatsApp | WAHA (motor NOWEB) |
| Empacotamento | Docker Compose |

Monorepo pnpm: `apps/api`, `apps/web`, `packages/shared`.

---

## Desenvolvimento

```bash
cp .env.example .env
./scripts/gen-secrets.sh      # gera os segredos e imprime a senha do painel
docker compose up -d          # postgres, redis e waha
pnpm install
cd apps/api && pnpm db:migrate && pnpm db:seed && cd ../..
pnpm dev                      # api e painel, com hot reload
```

- Painel: `http://localhost:5173`
- API: `http://localhost:3001`
- Documentação: `http://localhost:3001/docs`

Confira se subiu:

```bash
docker compose ps      # os três "healthy"
pnpm smoke             # compila, sobe a API e verifica /health/ready
```

### Portas

Todas vêm do `.env` — `WEB_PORT`, `API_PORT`, `POSTGRES_PORT`, `REDIS_PORT`, `WAHA_PORT` —
mais `BIND_ADDRESS`, que decide entre `127.0.0.1` (só a sua máquina) e `0.0.0.0` (rede
local). **Nenhuma porta é fixa** em compose, Dockerfile, nginx ou código.

Conflito com algo que já roda? Edite a linha, rode `./scripts/gen-secrets.sh` para
re-sincronizar as URLs derivadas, e suba de novo:

```bash
WAHA_PORT=3910 POSTGRES_PORT=5544 docker compose up -d
```

O painel também não congela a URL da API: ele chama `/api` relativo, e o destino é
resolvido pelo proxy do Vite em desenvolvimento e pelo `envsubst` do nginx em produção.

### Comandos

```bash
pnpm dev              # api + painel
pnpm test             # testes unitários
pnpm test:e2e         # e2e (banco separado, WAHA dublado)
pnpm smoke            # a aplicação realmente sobe?
pnpm lint             # eslint
pnpm typecheck        # tipos
pnpm openapi:export   # regenera docs/openapi.json e as coleções
pnpm openapi:lint     # valida a especificação
```

Do lado do banco (`apps/api`):

```bash
pnpm db:migrate   pnpm db:seed   pnpm db:studio   pnpm db:reset
```

---

## Produção

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

WAHA, Postgres e Redis **não publicam porta** — só existem na rede interna. As migrations
rodam em um container próprio que precisa terminar antes de a API subir.

O passo a passo completo, incluindo TLS e backup agendado, está em
[`docs/deploy.md`](docs/deploy.md).

---

## Documentação

| Documento | Para quem |
|---|---|
| **[Guia de integração](docs/integracao.md)** | quem vai consumir a API — do zero à primeira mensagem, com exemplos em curl, Node, PHP e Python |
| [Deploy](docs/deploy.md) | quem vai colocar em produção |
| [Runbook](docs/runbook.md) | quem opera — organizado por sintoma |
| [Segurança](docs/seguranca.md) | o que está protegido e o que exige cuidado |
| [Modelo de dados](docs/modelo-de-dados.md) | quem vai mexer no código |
| [Infraestrutura](docs/infraestrutura.md) | os containers, portas e armadilhas |
| [`openapi.json`](docs/openapi.json) | geradores de client |
| [`collections/`](docs/collections/) | Insomnia e Postman |

Com a API rodando, `/docs` traz a especificação navegável com "Try it out".

---

## Convenções

- **Código e identificadores em inglês**; documentação, interface e mensagens de erro
  voltadas ao usuário em **PT-BR**.
- O WAHA nunca é exposto publicamente.
- Segredos jamais em log; API keys exibidas uma única vez, na criação.
- Toda porta vem do `.env`, com default interpolado.
- Erros seguem RFC 7807 (`application/problem+json`) com `requestId` rastreável.

---

## Como isto foi construído

O plano e o passo a passo estão em [`tasks/`](tasks/) — 20 tarefas numeradas, cada uma com
checklist, critérios de aceite executáveis e notas sobre o que deu errado no caminho.
Comece pelo [índice](tasks/00-README.md).

As notas registram as armadilhas concretas: o `migrations.path` que quebra o `migrate
status` do Prisma 7 em silêncio, o autofix do ESLint que apaga o metadado da injeção de
dependência do NestJS, o `MockAgent` do undici que memoiza respostas, o `proxy_buffering`
que entrega SSE em lote. Cada uma custou um ciclo de depuração.
