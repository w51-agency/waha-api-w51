# 20 — Testes, produção e entrega

**Status:** ⬜ pendente
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
- [ ] Vitest configurado na API e no painel, com cobertura
- [ ] Unit: serviços de API key, sessões, ingestão de webhook, cliente WAHA, normalização de chatId, assinatura HMAC
- [ ] e2e com supertest + Postgres efêmero + WAHA mockado por MSW
- [ ] **Teste de isolamento**: aplicação B recebe 404 em sessão, mensagem e mídia da aplicação A
- [ ] Teste de idempotência da ingestão (evento repetido não duplica)
- [ ] Teste de que envio não é retentado automaticamente
- [ ] Teste da rotação de refresh token
- [ ] Fixtures e factories reutilizáveis; banco limpo entre testes
- [ ] Meta de cobertura acordada nos caminhos críticos (auth, isolamento, ingestão)
- [ ] `pnpm test`, `pnpm test:e2e`, `pnpm test:cov` na raiz

### Imagens
- [ ] `docker/api/Dockerfile` multi-stage (deps → build → runtime `node:22-alpine`)
- [ ] `docker/web/Dockerfile` multi-stage (build Vite → nginx alpine)
- [ ] Usuário não-root nos dois
- [ ] `.dockerignore` completo
- [ ] Healthcheck em cada imagem
- [ ] `dumb-init`/`tini` para encaminhar sinais e não deixar processo zumbi
- [ ] Tamanho final das imagens conferido e anotado

### Produção
- [ ] `docker-compose.prod.yml`: WAHA e Postgres **sem `ports:`**, apenas na rede interna
- [ ] Serviço `migrate` rodando `prisma migrate deploy` antes da API (`depends_on` com `service_completed_successfully`)
- [ ] `restart: unless-stopped` em todos
- [ ] Limites de memória e CPU por serviço
- [ ] Rotação de log configurada (`json-file` com `max-size`/`max-file`)
- [ ] Todas as portas ainda vindas do `.env`, com defaults
- [ ] `docker-compose.tls.yml` opcional com Caddy para HTTPS automático

### Backup
- [ ] `scripts/backup.sh` — `pg_dump` dos dois databases, comprimido e datado
- [ ] `scripts/restore.sh` com confirmação explícita
- [ ] Instruções de agendamento por cron
- [ ] **Restauração testada de verdade** em ambiente limpo, não só o script escrito

### CI
- [ ] Workflow rodando lint, typecheck, test, build e o Spectral do OpenAPI
- [ ] Build das imagens Docker validado no CI

### Documentação final
- [ ] `README.md` completo: visão geral, arquitetura, subida em dev, deploy, variáveis
- [ ] `docs/deploy.md` — passo a passo em servidor limpo, do zero ao primeiro número conectado
- [ ] `docs/runbook.md` — sessão caindo, WAHA sem responder, fila travada, webhook falhando, banco cheio, como ler os logs
- [ ] `docs/seguranca.md` — modelo de ameaças, o que está protegido, o que exige cuidado na operação
- [ ] `docs/integracao.md` revisado (tarefa 15)
- [ ] Diagrama de arquitetura no README

### Verificação final de portas
- [ ] Nenhuma porta literal fora de interpolação em compose, Dockerfile, nginx ou código
- [ ] Subida completa com portas não-default validada de ponta a ponta

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

_(preencher durante a execução)_
