# 04 — Bootstrap da API NestJS

**Status:** ⬜ pendente
**Depende de:** 03
**Habilita:** 05 em diante

## Objetivo

Levantar o app NestJS em `apps/api` com tudo que é transversal: configuração validada,
logging estruturado, tratamento de erro padronizado, health checks, Swagger servido em
`/docs` e o módulo Prisma. Ao final, `GET /health/ready` responde e `/docs` abre — ainda
sem nenhuma rota de negócio.

## Contexto

Este é o alicerce da API. Três decisões aqui evitam retrabalho depois:

- **`rawBody: true` no `NestFactory.create`.** A tarefa 10 precisa do corpo bruto da
  requisição para verificar o HMAC-SHA512 dos webhooks do WAHA. Se o body for parseado e
  reserializado, a assinatura não bate. Configurar agora.
- **Erro no formato RFC 7807 (`application/problem+json`)** desde o início, para que o
  Swagger documente um contrato de erro único e os integradores tratem uma coisa só.
- **A porta vem de `${API_PORT}`**, com default 3001 — nunca literal.

## Checklist

### Aplicação
- [ ] NestJS instalado em `apps/api` com `main.ts`, `app.module.ts`
- [ ] `NestFactory.create(AppModule, { rawBody: true, bufferLogs: true })`
- [ ] `app.listen(config.API_PORT, '0.0.0.0')` — porta do `.env`, bind `0.0.0.0` dentro do container
- [ ] Prefixo global: nenhum (as rotas já nascem com `/v1`, `/admin`, `/internal`)
- [ ] Graceful shutdown (`app.enableShutdownHooks()`) para fechar Prisma/BullMQ limpo

### Configuração
- [ ] `ConfigModule` global com schema **Zod** validando todas as variáveis na subida
- [ ] App **falha ao iniciar** com mensagem clara em PT-BR se faltar variável obrigatória
- [ ] Segredos com comprimento mínimo validado (`JWT_SECRET` ≥ 32 chars)
- [ ] Serviço `AppConfig` tipado, injetável — nada de `process.env` espalhado pelo código

### Observabilidade
- [ ] `nestjs-pino` com `WAHA_LOG_FORMAT` controlando pretty vs JSON
- [ ] **Redaction obrigatória**: `req.headers.authorization`, `req.headers["x-api-key"]`, `*.password`, `*.secret`, `*.hash`, `*.token`
- [ ] `x-request-id` gerado se ausente, propagado no log e ecoado na resposta

### Erros
- [ ] `AllExceptionsFilter` global devolvendo `{ type, title, status, detail, instance, requestId, errors? }`
- [ ] Erros do Prisma (P2002 conflito, P2025 não encontrado) traduzidos para 409/404
- [ ] `ValidationPipe` global: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- [ ] Mensagens de validação em PT-BR

### Segurança de base
- [ ] `helmet`
- [ ] CORS por allowlist vinda do `.env` (`CORS_ORIGINS`)
- [ ] Limite de corpo configurável (`BODY_LIMIT`, default 25mb — mídia passa por aqui na tarefa 11)
- [ ] `@nestjs/throttler` instalado com storage Redis (limites afinados na tarefa 05)

### Health
- [ ] `GET /health` — liveness, sem dependências
- [ ] `GET /health/ready` — readiness checando Postgres, Redis e WAHA
- [ ] Readiness devolve 503 com detalhe de qual dependência caiu

### Swagger (base)
- [ ] `DocumentBuilder` com título, descrição em PT-BR, versão e servidores
- [ ] `securitySchemes`: `ApiKeyAuth` (header `X-API-Key`) e `BearerAuth` (JWT do painel)
- [ ] Tags declaradas: Sessões, Mensagens, Chats, Webhooks, Conta, Admin
- [ ] Swagger UI em `/docs`, JSON cru em `/docs-json`
- [ ] `/docs` desabilitável por `SWAGGER_ENABLED=false`

### Prisma
- [ ] `PrismaModule` global com `PrismaService` (`onModuleInit` conecta, `onModuleDestroy` desconecta)
- [ ] Log de query em nível debug apenas quando `LOG_LEVEL=debug`

## Critérios de aceite

```bash
cd apps/api && pnpm dev
curl -s localhost:3001/health | jq .              # { "status": "ok" }
curl -s localhost:3001/health/ready | jq .        # postgres, redis e waha "up"
curl -s localhost:3001/docs-json | jq '.info.title, .components.securitySchemes'
xdg-open http://localhost:3001/docs               # Swagger UI carrega

# erro sai no formato padronizado
curl -s localhost:3001/rota-inexistente | jq .    # problem+json com requestId

# a config falha alto quando falta segredo
JWT_SECRET= pnpm dev                              # aborta com mensagem clara em PT-BR

# a porta vem do env
API_PORT=4001 pnpm dev & sleep 3 && curl -s localhost:4001/health | jq .
```

- Nenhum segredo aparece no log: `pnpm dev 2>&1 | grep -iE 'x-api-key|password' ` não retorna valor em claro.

## Notas

_(preencher durante a execução)_
