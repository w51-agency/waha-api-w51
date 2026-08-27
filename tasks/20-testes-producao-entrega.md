# 20 — Testes, produção e entrega

**Status:** ✅ CONCLUÍDA
**Depende de:** todas
**Habilita:** —

## Objetivo

Fechar o projeto: suíte de testes automatizados, imagens de produção, compose endurecido
para deploy, rotina de backup e a documentação operacional que permite manter o sistema
sem consultar quem o construiu.

## Contexto

O `.plan/start.md` diz *"esse sistema vai rodar dockerizado pra facilitar deploy"* — é aqui
que essa promessa se cumpre de verdade.

Diferenças do compose de produção em relação ao de desenvolvimento, e o motivo de cada uma:

- **WAHA e Postgres não publicam porta.** Em dev é útil depurar direto; em produção, o WAHA
  exposto é uma sessão de WhatsApp de alguém à mercê da internet. Só o painel (e
  opcionalmente a API) atravessa para o host.
- **Imagens buildadas em multi-stage**, sem devDependencies nem código-fonte.
- **Container roda como usuário sem privilégio**, com `read_only` onde possível.
- **Limites de memória e CPU declarados** — uma sessão problemática não pode derrubar o host.
- **Migrations aplicadas por `migrate deploy`** (nunca `migrate dev`, que pode reescrever
  histórico) em um passo separado antes da API subir.

Os testes e2e mockam o WAHA com MSW: precisam ser determinísticos e rodar sem WhatsApp real.

## Checklist

### Testes
- [x] Vitest configurado na API e no painel, com cobertura
- [x] Unit: serviços de API key, sessões, ingestão de webhook, cliente WAHA, normalização de chatId, assinatura HMAC
- [x] e2e com supertest + Postgres efêmero + WAHA mockado por MSW
- [x] **Teste de isolamento**: aplicação B recebe 404 em sessão, mensagem e mídia da aplicação A
- [x] Teste de idempotência da ingestão (evento repetido não duplica)
- [x] Teste de que envio não é retentado automaticamente
- [x] Teste da rotação de refresh token
- [x] Fixtures e factories reutilizáveis; banco limpo entre testes
- [x] Meta de cobertura acordada nos caminhos críticos (auth, isolamento, ingestão)
- [x] `pnpm test`, `pnpm test:e2e`, `pnpm test:cov` na raiz

### Imagens
- [x] `docker/api/Dockerfile` multi-stage (deps → build → runtime `node:22-alpine`)
- [x] `docker/web/Dockerfile` multi-stage (build Vite → nginx alpine)
- [x] Usuário não-root nos dois
- [x] `.dockerignore` completo
- [x] Healthcheck em cada imagem
- [x] `dumb-init`/`tini` para encaminhar sinais e não deixar processo zumbi
- [x] Tamanho final das imagens conferido e anotado

### Produção
- [x] `docker-compose.prod.yml`: WAHA e Postgres **sem `ports:`**, apenas na rede interna
- [x] Serviço `migrate` rodando `prisma migrate deploy` antes da API (`depends_on` com `service_completed_successfully`)
- [x] `restart: unless-stopped` em todos
- [x] Limites de memória e CPU por serviço
- [x] Rotação de log configurada (`json-file` com `max-size`/`max-file`)
- [x] Todas as portas ainda vindas do `.env`, com defaults
- [x] `docker-compose.tls.yml` opcional com Caddy para HTTPS automático

### Backup
- [x] `scripts/backup.sh` — `pg_dump` dos dois databases, comprimido e datado
- [x] `scripts/restore.sh` com confirmação explícita
- [x] Instruções de agendamento por cron
- [x] **Restauração testada de verdade** em ambiente limpo, não só o script escrito

### CI
- [x] Workflow rodando lint, typecheck, test, build e o Spectral do OpenAPI
- [x] Build das imagens Docker validado no CI

### Documentação final
- [x] `README.md` completo: visão geral, arquitetura, subida em dev, deploy, variáveis
- [x] `docs/deploy.md` — passo a passo em servidor limpo, do zero ao primeiro número conectado
- [x] `docs/runbook.md` — sessão caindo, WAHA sem responder, fila travada, webhook falhando, banco cheio, como ler os logs
- [x] `docs/seguranca.md` — modelo de ameaças, o que está protegido, o que exige cuidado na operação
- [x] `docs/integracao.md` revisado (tarefa 15)
- [x] Diagrama de arquitetura no README

### Verificação final de portas
- [x] Nenhuma porta literal fora de interpolação em compose, Dockerfile, nginx ou código
- [x] Subida completa com portas não-default validada de ponta a ponta

## Critérios de aceite

```bash
# suíte completa
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build

# produção do zero
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps            # todos healthy, migrate concluído

# WAHA e Postgres NÃO acessíveis do host
curl -s -m 3 -o /dev/null -w '%{http_code}\n' localhost:3000/health || echo "inacessível — correto"
nc -z localhost 5432 && echo "FALHA: porta exposta" || echo "postgres fechado — correto"

# painel e API respondem
curl -s -o /dev/null -w '%{http_code}\n' localhost:${WEB_PORT:-8080}/
curl -s localhost:${WEB_PORT:-8080}/api/health | jq .

# portas configuráveis, mais uma vez
docker compose -f docker-compose.prod.yml down
WEB_PORT=9090 API_PORT=4001 POSTGRES_PORT=5544 REDIS_PORT=6399 \
  docker compose -f docker-compose.prod.yml up -d
curl -s localhost:9090/api/health | jq .

# nenhuma porta hardcoded
grep -RnE '(^|[^0-9${])(3000|3001|5432|6379|8080)([^0-9]|$)' \
  docker-compose*.yml docker/ apps/*/src 2>/dev/null | grep -v '\${' | grep -v node_modules
# saída vazia esperada

# backup e restauração de verdade
./scripts/backup.sh && ls -lh backups/
./scripts/restore.sh backups/<arquivo>.sql.gz      # em ambiente limpo, dados voltam

# fluxo completo em produção: conectar um número e enviar uma mensagem pelo painel
```

## Notas

### Quatro problemas que só apareceram ao empacotar

**1. O plugin do Swagger emite caminho relativo ao monorepo.**

A imagem morria no arranque com
`Cannot find module '../../../../../../../packages/shared/dist/index'`. O plugin do
`@nestjs/swagger` gera os metadados dos DTOs com `require` de **caminho relativo calculado
no build** — e a imagem original achatava a estrutura para `/app/dist`.

A correção foi preservar o layout do monorepo na imagem (`/app/apps/api`,
`/app/packages/shared`). Contando os `../` do erro, o caminho resolve exatamente.

**2. O `prisma.config.ts` não resolve symlinks do pnpm.**

`require('dotenv')` funcionava no Node normal e falhava no carregador de configuração do
Prisma com "Cannot find module" — **com o pacote presente na imagem** (`require.resolve`
confirmava). Mover o dotenv para dependências de produção não resolveu.

Como a necessidade era ler um arquivo `chave=valor`, oito linhas de `node:fs` eliminaram a
dependência e o problema de uma vez.

**3. `migrate` e `api` construíam imagens separadas do mesmo Dockerfile.**

Cada serviço com sua seção `build` gera sua própria imagem, e elas divergem de cache. Isso
produziu um migrate rodando código antigo enquanto a API rodava o novo — um jeito silencioso
de aplicar a migration errada. Os dois passaram a compartilhar a tag via `image:`.

**4. O `lint:fix` reordenou um import e quebrou os testes e2e.**

A regra `import/order` moveu `../src/prisma/prisma.service` para antes de `./app.factory`.
Como o `ConfigModule` do Nest valida e cacheia as variáveis no momento em que é carregado, a
cadeia passou a ler o **`.env` real** em vez do de teste — e 6 testes começaram a falhar com
401.

A correção estrutural: o ambiente de teste virou `setupFiles` do vitest, cuja ordem é
garantida. Depender da ordem dos imports era frágil, e o linter provou isso.

### A restauração foi testada, não apenas escrita

```
4 aplicações → backup → TRUNCATE CASCADE → 0 aplicações → restore → 4 aplicações
```

Um backup nunca restaurado é uma suposição. O script confere a integridade do gzip logo após
gerar — um dump truncado passaria despercebido até a hora em que ele importa.

### O dublê do WAHA e o `MockAgent`

O `MockAgent` do undici **invoca o callback de resposta uma única vez** e reusa o resultado,
tanto com `.persist()` quanto com `.times(n)` — verificado com uma sonda: três requisições,
um callback.

Como o dublê responde a partir de estado mutável (a sessão vira `WORKING` no meio do teste),
uma resposta memoizada devolvia o estado antigo para sempre. A única forma de reinvocar é
registrar interceptadores separados — daí o laço de 300 por método, reposto a cada limpeza.

O MSW foi tentado antes e não serve aqui: ele se instala no módulo `http` do Node, e o
`undici.request()` o contorna.

### Isolamento de rede em produção — verificado

```
painel (8080)     200
API (3001)        fechada
WAHA (3010)       fechada
Postgres (5432)   fechada
Redis (6379)      fechada
```

O WAHA exposto seria uma sessão de WhatsApp de alguém à mercê da internet.

### Portas configuráveis em produção — verificado

`WEB_PORT=9090 API_PORT=4001 docker compose -f docker-compose.prod.yml up -d` funcionou
**sem reconstruir imagem alguma**: o painel chama `/api` relativo e o nginx resolve o destino
por `envsubst` no arranque.

### Verificação executada

```
pnpm lint / typecheck / format:check / build      todos verdes
pnpm test                                          150 testes unitários
pnpm test:e2e                                      27 testes e2e
pnpm smoke                                         OK
pnpm openapi:export + redocly lint                 0 erros

imagens                                            api 533 MB, painel 53 MB
pilha de produção                                  5 containers, todos healthy
  migrate                                          Exited (0), antes da API
fluxo completo em produção                         login, app, chave, sessão, QR (PNG 5326 B)
  metadata de rastreio no WAHA                     4 chaves + webhook http://api:3001/...
isolamento de rede                                 só o painel publicado
portas não-default                                 9090/4001 sem rebuild

backup                                             gateway 12K + waha 4K, gzip íntegro
restauração                                        4 apps → 0 → 4 apps

grep de porta literal em compose                   nenhuma
```

### O que fica pendente de verificação humana

O envio real de mensagem exige um número conectado por QR — o que precisa de um celular.
Toda a mecânica está coberta por testes com o WAHA dublado, e o QR real foi obtido do WAHA
verdadeiro em desenvolvimento e em produção.

### Três falhas encontradas depois da entrega

**1. O painel abria em branco em `pnpm dev`.** O alias `@` existia só no `tsconfig`; o
`tsc` lê `paths`, o servidor do Vite não. O build de produção passava, por isso não foi
pego. Corrigido com `resolve.alias` explícito no `vite.config.ts`.

**2. `does not provide an export named 'MessageStatus'`.** O `@gateway/shared` é compilado
em CommonJS para o NestJS e o Vite servia o `dist` cru ao browser. O painel agora aponta
`@gateway/shared` para o fonte (`packages/shared/src/index.ts`), no Vite e no tsconfig —
sem CJS no browser, sem depender do `dist`, com hot reload.

**3. Sessões órfãs no WAHA em loop de 401.** `docker-compose.yml` e
`docker-compose.prod.yml` tinham o mesmo `name`, logo os mesmos volumes: sessões criadas em
produção (`http://api:3001`) reapareciam no WAHA de dev, sem registro no banco e com HMAC
que ninguém conhecia. Dois ajustes: o compose de produção ganhou nome próprio, e a
reconciliação por cron passou a remover órfãs carimbadas pelo gateway e a corrigir a URL e o
segredo do webhook de toda sessão local.

