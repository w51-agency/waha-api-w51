# 04 — Bootstrap da API NestJS

**Status:** ✅ CONCLUÍDA
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
- [x] NestJS instalado em `apps/api` com `main.ts`, `app.module.ts`
- [x] `NestFactory.create(AppModule, { rawBody: true, bufferLogs: true })`
- [x] `app.listen(config.API_PORT, '0.0.0.0')` — porta do `.env`, bind `0.0.0.0` dentro do container
- [x] Prefixo global: nenhum (as rotas já nascem com `/v1`, `/admin`, `/internal`)
- [x] Graceful shutdown (`app.enableShutdownHooks()`) para fechar Prisma/BullMQ limpo

### Configuração
- [x] `ConfigModule` global com schema **Zod** validando todas as variáveis na subida
- [x] App **falha ao iniciar** com mensagem clara em PT-BR se faltar variável obrigatória
- [x] Segredos com comprimento mínimo validado (`JWT_SECRET` ≥ 32 chars)
- [x] Serviço `AppConfig` tipado, injetável — nada de `process.env` espalhado pelo código

### Observabilidade
- [x] `nestjs-pino` com `WAHA_LOG_FORMAT` controlando pretty vs JSON
- [x] **Redaction obrigatória**: `req.headers.authorization`, `req.headers["x-api-key"]`, `*.password`, `*.secret`, `*.hash`, `*.token`
- [x] `x-request-id` gerado se ausente, propagado no log e ecoado na resposta

### Erros
- [x] `AllExceptionsFilter` global devolvendo `{ type, title, status, detail, instance, requestId, errors? }`
- [x] Erros do Prisma (P2002 conflito, P2025 não encontrado) traduzidos para 409/404
- [x] `ValidationPipe` global: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- [x] Mensagens de validação em PT-BR

### Segurança de base
- [x] `helmet`
- [x] CORS por allowlist vinda do `.env` (`CORS_ORIGINS`)
- [x] Limite de corpo configurável (`BODY_LIMIT`, default 25mb — mídia passa por aqui na tarefa 11)
- [x] `@nestjs/throttler` instalado com storage Redis (limites afinados na tarefa 05)

### Health
- [x] `GET /health` — liveness, sem dependências
- [x] `GET /health/ready` — readiness checando Postgres, Redis e WAHA
- [x] Readiness devolve 503 com detalhe de qual dependência caiu

### Swagger (base)
- [x] `DocumentBuilder` com título, descrição em PT-BR, versão e servidores
- [x] `securitySchemes`: `ApiKeyAuth` (header `X-API-Key`) e `BearerAuth` (JWT do painel)
- [x] Tags declaradas: Sessões, Mensagens, Chats, Webhooks, Conta, Admin
- [x] Swagger UI em `/docs`, JSON cru em `/docs-json`
- [x] `/docs` desabilitável por `SWAGGER_ENABLED=false`

### Prisma
- [x] `PrismaModule` global com `PrismaService` (`onModuleInit` conecta, `onModuleDestroy` desconecta)
- [x] Log de query em nível debug apenas quando `LOG_LEVEL=debug`

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

### O bug que build e lint não pegam

`pnpm lint:fix` converteu imports de classes injetadas para `import type`, seguindo a regra
`@typescript-eslint/consistent-type-imports`. Isso apaga o metadado de tipo que os
decorators do NestJS usam, e a aplicação passou a falhar na subida com
`Nest can't resolve dependencies of the PrismaService (?)` — um erro cujo rastro **não
aponta para o import**.

O grave é que `pnpm build`, `pnpm typecheck` e `pnpm lint` continuavam todos verdes. A
regra ficou desligada em `apps/api` (comentada no `eslint.config.mjs` explicando o porquê),
e a resposta estrutural foi criar **`scripts/smoke.sh`** — compila, sobe a API de verdade e
confere `/health/ready`. Toda tarefa daqui em diante fecha com `pnpm smoke`, porque
verificação estática não prova que uma aplicação com injeção de dependência sobe.

### Decisões

- **`rawBody: true` desde já**, seis tarefas antes de ser usado. O HMAC dos webhooks do WAHA
  (tarefa 10) é calculado sobre os bytes exatos recebidos; se o corpo for parseado e
  reserializado, a assinatura não bate. Habilitar depois exigiria refazer o bootstrap.
- **Dois documentos Swagger separados** (`/docs` público, `/docs/admin`), com `/internal/*`
  fora dos dois. Publicar o endpoint de webhook interno seria entregar mapa de superfície de
  ataque.
- **`validateEnvOrExit`** em vez de deixar a exceção subir. O `ConfigModule.forRoot` roda no
  momento em que o módulo é importado, antes do `bootstrap()` e do seu `catch` — a exceção
  virava 20 linhas de stack trace com a mensagem útil no meio. Agora sai limpa, listando
  **todas** as variáveis problemáticas de uma vez, e encerra com código 1. A `validateEnv`
  continua exportada e pura, para os testes.
- **`@SkipThrottle()` nas sondas de saúde.** O healthcheck do Docker bate a cada 10s; somado
  a probes de balanceador, esgotaria a cota e o container seria marcado como não saudável
  por excesso de verificação de saúde — o oposto do que a sonda existe para fazer.
- **Storage do throttler no Redis**, não em memória: com mais de uma instância da API, um
  contador por processo multiplicaria o limite real pelo número de réplicas.
- **`GET /` adicionado** (fora do checklist). Uma raiz que devolve 404 é hostil — a primeira
  coisa que alguém faz ao receber uma URL é abri-la. Agora aponta `/docs` e `/health`.

### Mensagens de erro: três correções

O contrato RFC 7807 estava certo, mas o conteúdo escapava da convenção PT-BR:

1. **404 de rota inexistente** vinha do Nest como `"Cannot GET /x"` com título `"Not Found"`.
   É a primeira mensagem que todo integrador encontra ao errar um caminho. Agora:
   *"A rota GET /x não existe. Consulte a documentação em /docs."*
2. **Corpo grande demais devolvia 500.** Os erros do body-parser chegam como erro cru com
   `type`/`status`, não como `HttpException`, e caíam no ramo "desconhecido". Quem enviasse
   mídia acima do limite receberia "erro interno". Agora 413 com o limite explícito.
3. **JSON malformado** repassava a mensagem do V8 em inglês. Traduzida.

Também: o `requestId` saía como `"desconhecido"` em erros do body-parser, porque o pino
atribui o id depois. Passou a gerar um UUID no filtro — um erro sem id é um erro que não dá
para achar no log, justamente quando alguém pede suporte.

### Redaction — verificada, não assumida

Testada com segredos plantados em header e corpo: `x-api-key`, `authorization`, `password`,
`secret`, `token`, mais os segredos reais do `.env`. **Nenhum apareceu em claro**; os campos
saem como `[oculto]`.

### Correção no `.env`: valores com espaço

`WAHA_CLIENT_DEVICE_NAME=Gateway W51` quebrava `set -a; source .env` — que é exatamente como
os critérios de aceite deste projeto carregam as variáveis. Docker Compose e dotenv aceitam
sem aspas, o shell não. Todos os valores com espaço passaram a ser citados, no `.env.example`
e no `.env`.

### Prisma 7 no runtime

O `PrismaService` precisa instanciar `PrismaPg` com a connection string: no Prisma 7 a URL
vive em `prisma.config.ts`, que só o CLI enxerga. Sem o adapter, o client não conecta.

### Verificação executada

```
GET /                        200
GET /health                  status ok
GET /health/ready            ok -> postgres:up, redis:up, waha:up
GET /docs                    200   (Swagger UI)
GET /docs/admin              200   (documento separado)
GET /docs-json               200   securitySchemes: [ApiKeyAuth], 6 tags
  rotas /admin no doc público      0
  rotas /internal no doc público   0

content-type do erro         application/problem+json
404                          PT-BR, apontando /docs
JSON malformado              400 PT-BR
corpo de 30MB (limite 25mb)  413 "excede o limite de 25 MB"
x-request-id                 ecoado quando enviado, gerado quando ausente

CORS origem permitida        header presente
CORS origem estranha         header ausente
helmet                       x-content-type-options presente

rate limit (120/60s)         120x 200 + 10x 429
  chaves no Redis            {hash:default}:hits / :blocked
  X-RateLimit-Limit          120
  X-RateLimit-Remaining      118
  Retry-After                60 (na resposta 429)
  /health                    150/150 passam (SkipThrottle)

config sem JWT_SECRET        mensagem limpa listando tudo, exit 1
JWT_SECRET curto             rejeitado com instrução do gen-secrets.sh
API_PORT=4001                sobe na porta nova, 3001 fechada

redaction                    nenhum segredo em claro no log

pnpm lint / typecheck / format:check / build / smoke   todos verdes
```
