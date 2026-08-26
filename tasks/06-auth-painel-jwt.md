# 06 — Autenticação do painel (JWT)

**Status:** ✅ CONCLUÍDA
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
- [x] `POST /admin/auth/login` recebendo `{ username, password }`
- [x] Verificação argon2id em tempo constante; usuário inexistente também paga o custo do hash
- [x] Resposta: `{ accessToken, refreshToken, expiresIn, user: { username } }`
- [x] Falha devolve 401 genérico ("Usuário ou senha inválidos"), sem distinguir o motivo
- [x] `AuditLog` de login bem-sucedido e de tentativa falha (com IP e user-agent)

### Tokens
- [x] Access token JWT HS256, TTL de `JWT_ACCESS_TTL` (default 15m), claims `sub`, `role`, `jti`
- [x] Refresh token opaco (32 bytes aleatórios), guardado no Redis com TTL de `JWT_REFRESH_TTL` (default 7d)
- [x] `POST /admin/auth/refresh` — rotaciona: emite par novo e invalida o anterior
- [x] Reuso de refresh já consumido → invalida toda a família e força novo login
- [x] `POST /admin/auth/logout` — remove o refresh do Redis
- [x] `GET /admin/auth/me` — devolve a identidade corrente

### Guard
- [x] `AdminGuard` validando o JWT em todas as rotas `/admin/*`
- [x] `@CurrentAdmin()` para injetar o ator na auditoria
- [x] Token expirado devolve 401 com `type` distinguível, para o painel disparar o refresh automático

### Proteção contra força bruta
- [x] Throttler dedicado no login: por IP, limite baixo (ex.: 5 tentativas / 5 min)
- [x] Backoff progressivo após falhas consecutivas, contador no Redis
- [x] Resposta 429 informando quando tentar de novo

### Segurança
- [x] `JWT_SECRET` e `JWT_REFRESH_SECRET` distintos e validados com mínimo de 32 chars (tarefa 04)
- [x] Aviso na subida se `ADMIN_PASSWORD` for o valor de exemplo (`troque-me`)
- [x] Senha jamais logada, nem em nível debug

### Testes
- [x] Unit: credencial correta emite par; incorreta devolve 401
- [x] Unit: refresh rotaciona e invalida o anterior; reuso invalida a família
- [x] Unit: rota `/admin` sem token devolve 401

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

### Defesa contra oráculo por temporização

Com um único usuário administrativo, o nome ("admin") é adivinhável e a senha é tudo. Se o
serviço saísse cedo ao ver um usuário inexistente, a diferença de tempo de resposta
confirmaria qual nome existe. Por isso há um **hash descartável** derivado na subida: quando
o usuário não confere, o argon2 roda contra ele mesmo assim.

Medido em execução: **28 ms com usuário certo, 30 ms com usuário inexistente** — dentro do
ruído.

O primeiro teste dessa medição saiu errado (0,02 s nos dois casos): o rate limit já havia
estourado e as requisições voltavam 429 instantaneamente, sem chegar ao argon2. Refeito com
o contador limpo.

### Rotação de refresh com detecção de reuso

O refresh é consumido no momento em que é trocado (`GETDEL`, atômico). Um token que aparece
duas vezes significa que alguém tem uma cópia — e não há como saber qual das duas partes é a
legítima. A resposta é derrubar a **família inteira** e exigir novo login.

Isso tem uma consequência prática que o painel precisa respeitar (tarefa 16): requisições
concorrentes que recebam 401 ao mesmo tempo não podem disparar refreshes simultâneos, senão
o segundo é interpretado como reuso e derruba a sessão do usuário. O interceptor terá que
enfileirar as requisições durante a renovação.

### `expiresIn` em segundos, não como "15m"

O tipo do `@nestjs/jwt` só aceita literais de duração conhecidos em tempo de compilação, e o
valor vem de configuração. Usar `parseDuration` para os dois usos — o TTL do token e o
`expiresIn` da resposta — também garante que não divirjam.

### `token-expired` distinto de `invalid-token`

O `type` do erro distingue os casos, para o painel decidir entre renovar em silêncio e
mandar o usuário refazer o login.

### Verificação executada

```
login com credencial correta       accessToken (3 partes), refreshToken (64 chars), 900s
senha errada / usuário errado      401, mesma mensagem nos dois
/admin/auth/me sem token           401
/admin/auth/me com token           200
token malformado                   401

rotação: 1o refresh                200
rotação: reuso do mesmo            401

força bruta (limite 5/5min)        5x 401 + 4x 429
temporização                       28ms (usuário certo) x 30ms (inexistente)

pnpm test                          56 testes, 3 arquivos
pnpm smoke / lint / format         verdes
```
