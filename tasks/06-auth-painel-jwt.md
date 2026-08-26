# 06 — Autenticação do painel (JWT)

**Status:** ⬜ pendente
**Depende de:** 04
**Habilita:** 08, 14, 16

## Objetivo

Implementar o login do painel administrativo com **usuário único vindo do `.env`**
(decisão confirmada), emitindo JWT de acesso + refresh token rotacionado, e o `AdminGuard`
que protege todas as rotas `/admin/*`.

## Contexto

Não há tabela de usuários nem CRUD de contas — `ADMIN_USERNAME` e `ADMIN_PASSWORD` vêm do
ambiente. Isso mantém o escopo enxuto, mas exige três cuidados para não virar um ponto fraco:

1. A senha do `.env` é comparada com **argon2id** contra um hash derivado na subida (não
   comparação direta de string), e a verificação usa tempo constante mesmo quando o
   usuário não confere — evitando oráculo por temporização.
2. **Rate limit agressivo no `/admin/auth/login`** por IP: o endpoint é o único caminho de
   entrada e tem uma credencial só, então força bruta é o risco real. Bloqueio progressivo.
3. Refresh tokens ficam no **Redis** com jti, permitindo revogação real no logout e
   rotação — um refresh usado duas vezes invalida a família inteira (detecção de roubo).

## Checklist

### Login
- [ ] `POST /admin/auth/login` recebendo `{ username, password }`
- [ ] Verificação argon2id em tempo constante; usuário inexistente também paga o custo do hash
- [ ] Resposta: `{ accessToken, refreshToken, expiresIn, user: { username } }`
- [ ] Falha devolve 401 genérico ("Usuário ou senha inválidos"), sem distinguir o motivo
- [ ] `AuditLog` de login bem-sucedido e de tentativa falha (com IP e user-agent)

### Tokens
- [ ] Access token JWT HS256, TTL de `JWT_ACCESS_TTL` (default 15m), claims `sub`, `role`, `jti`
- [ ] Refresh token opaco (32 bytes aleatórios), guardado no Redis com TTL de `JWT_REFRESH_TTL` (default 7d)
- [ ] `POST /admin/auth/refresh` — rotaciona: emite par novo e invalida o anterior
- [ ] Reuso de refresh já consumido → invalida toda a família e força novo login
- [ ] `POST /admin/auth/logout` — remove o refresh do Redis
- [ ] `GET /admin/auth/me` — devolve a identidade corrente

### Guard
- [ ] `AdminGuard` validando o JWT em todas as rotas `/admin/*`
- [ ] `@CurrentAdmin()` para injetar o ator na auditoria
- [ ] Token expirado devolve 401 com `type` distinguível, para o painel disparar o refresh automático

### Proteção contra força bruta
- [ ] Throttler dedicado no login: por IP, limite baixo (ex.: 5 tentativas / 5 min)
- [ ] Backoff progressivo após falhas consecutivas, contador no Redis
- [ ] Resposta 429 informando quando tentar de novo

### Segurança
- [ ] `JWT_SECRET` e `JWT_REFRESH_SECRET` distintos e validados com mínimo de 32 chars (tarefa 04)
- [ ] Aviso na subida se `ADMIN_PASSWORD` for o valor de exemplo (`troque-me`)
- [ ] Senha jamais logada, nem em nível debug

### Testes
- [ ] Unit: credencial correta emite par; incorreta devolve 401
- [ ] Unit: refresh rotaciona e invalida o anterior; reuso invalida a família
- [ ] Unit: rota `/admin` sem token devolve 401

## Critérios de aceite

```bash
# login
TOKEN=$(curl -s -XPOST localhost:3001/admin/auth/login -H 'content-type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" | jq -r .accessToken)
echo "$TOKEN" | cut -c1-20                                  # token emitido

# senha errada
curl -s -o /dev/null -w '%{http_code}\n' -XPOST localhost:3001/admin/auth/login \
  -H 'content-type: application/json' -d '{"username":"admin","password":"errada"}'   # 401

# rota protegida
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/admin/auth/me                  # 401
curl -s localhost:3001/admin/auth/me -H "authorization: Bearer $TOKEN" | jq .          # 200

# rotação de refresh
R=$(curl -s -XPOST localhost:3001/admin/auth/login -H 'content-type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" | jq -r .refreshToken)
curl -s -XPOST localhost:3001/admin/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$R\"}" | jq .
curl -s -XPOST localhost:3001/admin/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$R\"}" | jq .   # 401, reuso detectado

# força bruta barrada
for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code} ' -XPOST localhost:3001/admin/auth/login \
  -H 'content-type: application/json' -d '{"username":"admin","password":"x"}'; done   # termina em 429

pnpm test -- admin-auth
```

## Notas

_(preencher durante a execução)_
