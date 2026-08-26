# WhatsApp Gateway W51

Gateway multi-sistema de WhatsApp construído sobre o [WAHA](https://waha.devlike.pro/)
no motor **NOWEB** — que fala com o WhatsApp por WebSocket, sem Chromium, consumindo
uma fração da memória dos motores baseados em navegador.

O projeto **não é** um fork do WAHA: é uma camada de gateway na frente dele. O WAHA fica
em rede interna, sem exposição pública, e todo acesso externo passa por esta API, que
autentica, autoriza, registra e repassa.

## O que ele faz

- **API própria documentada em Swagger**, para outros sistemas consumirem.
- **API keys por sistema integrador**, com isolamento: cada chave enxerga e opera apenas
  as sessões da própria aplicação.
- **Rastreio de origem do QR code** — toda solicitação de QR registra qual sistema pediu,
  qual chave, quando; e ao conectar, a qual número aquilo resultou.
- **Painel administrativo** com números conectados, histórico de mensagens, métricas e
  trilha de auditoria.
- **Webhooks de saída** assinados, com retentativas, para os sistemas receberem eventos.

## Stack

| Camada | Tecnologia |
|---|---|
| API | NestJS + Prisma + PostgreSQL + Swagger |
| Painel | React + Vite + Tailwind + shadcn/ui |
| Filas | BullMQ + Redis |
| WhatsApp | WAHA (motor NOWEB) |
| Empacotamento | Docker Compose |

Monorepo pnpm: `apps/api`, `apps/web`, `packages/shared`.

## Subindo em desenvolvimento

```bash
cp .env.example .env
./scripts/gen-secrets.sh      # gera os segredos no .env
docker compose up -d          # postgres, redis e waha
pnpm install
pnpm dev
```

> **Portas** — todas vêm do `.env` (`WEB_PORT`, `API_PORT`, `POSTGRES_PORT`, `REDIS_PORT`,
> `WAHA_PORT`). Nenhuma porta é fixa em compose, Dockerfile, nginx ou código: mudar uma
> linha do `.env` e reiniciar basta.

## Convenções

- **Código e identificadores em inglês**; documentação, interface e mensagens de erro
  voltadas ao usuário em **PT-BR**.
- O WAHA nunca é exposto publicamente.
- Segredos jamais aparecem em log; API keys são exibidas uma única vez, na criação.

## Desenvolvimento

O plano de construção e o passo a passo estão em [`tasks/`](tasks/) — 20 tarefas
numeradas, cada uma com checklist e critérios de aceite executáveis. Comece pelo
[índice](tasks/00-README.md).

## Documentação

- [`docs/`](docs/) — guia de integração, modelo de dados, deploy e runbook
- Swagger UI em `/docs` com a API rodando
