# 05 — Autenticação por API key

**Status:** ✅ CONCLUÍDA
**Depende de:** 04
**Habilita:** 08, 09, 11, 12, 13

## Objetivo

Implementar o mecanismo pelo qual os sistemas integradores se autenticam: geração,
armazenamento seguro, verificação e revogação de API keys, com escopos, rate limit por
chave e o guard que injeta a `Application` no contexto da requisição.

## Contexto

Esta é a peça que o `.plan/start.md` pede diretamente — *"criar api key para os sistemas
se conectarem"*. É também a base do **isolamento por aplicação**: toda rota `/v1` resolve
a chave para uma `Application`, e nenhuma consulta ao banco acontece sem esse filtro.

Formato da chave: `wgw_live_{prefix8}_{secret32}`.

O `prefix` é armazenado em claro e indexado — é ele que permite localizar o registro em
uma única query. O `secret` é verificado com **argon2id** contra o `hash`. Como argon2 é
propositalmente caro (~50-100ms), validar a cada requisição inviabilizaria a API: por isso
um **cache LRU em memória com TTL de 60s**, chaveado pelo hash SHA-256 da chave completa.
Revogação continua respeitada porque o TTL é curto e o cache é invalidado explicitamente
no momento da revogação.

Comparações de segredo usam `timingSafeEqual` — nunca `===`.

## Checklist

### Geração e verificação
- [x] `ApiKeyService.generate()`: 32 bytes aleatórios em base62, prefixo de 8 chars, retorna `{ plaintext, prefix, hash }`
- [x] Hash com `argon2id` (memória 19MiB, 2 iterações, paralelismo 1 — perfil OWASP)
- [x] `verify(plaintext)`: parse do formato → lookup por `prefix` → argon2.verify → checagem de `revokedAt`/`expiresAt`/`application.active`
- [x] Retorno genérico (401 "Credencial inválida") para todos os motivos de falha — não revelar se a chave existe, expirou ou foi revogada
- [x] `revoke(id)` grava `revokedAt` e **invalida o cache imediatamente**

### Cache
- [x] LRU em memória (`lru-cache`), TTL 60s, teto de entradas configurável
- [x] Chave do cache = SHA-256 da chave completa (nunca a chave em claro na memória do cache)
- [x] Invalidação explícita em revogação e em desativação da aplicação
- [x] `lastUsedAt` atualizado de forma assíncrona e debounced (no máximo 1 escrita/min por chave) — não bloquear a requisição

### Guard e decorators
- [x] `ApiKeyGuard` lendo `X-API-Key` (aceitar também `Authorization: Bearer` como alternativa documentada)
- [x] `@CurrentApplication()` — injeta a aplicação resolvida
- [x] `@CurrentApiKey()` — injeta a chave (para gravar `sentByApiKeyId` e auditoria)
- [x] `@Scopes('sessions:write')` + `ScopesGuard`
- [x] `@Public()` para health e docs
- [x] Escopos definidos: `sessions:read`, `sessions:write`, `messages:read`, `messages:send`, `chats:read`, `webhooks:manage`
- [x] Chave sem escopos declarados recebe o conjunto completo (padrão conveniente); escopos explícitos restringem

### Rate limit
- [x] Throttler com storage Redis, chaveado por `apiKey.id` (não por IP)
- [x] Limites default por `.env`: `RATE_LIMIT_TTL`, `RATE_LIMIT_LIMIT`
- [x] Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` na resposta
- [x] 429 no formato problem+json

### Auditoria
- [x] Todo uso de chave em operação de escrita gera `AuditLog` com `actorType: API_KEY`
- [x] Tentativa de autenticação falha é logada (com o prefixo, jamais a chave inteira)

### Testes
- [x] Unit: geração → verificação bate; chave adulterada falha; chave revogada falha; expirada falha
- [x] Unit: cache devolve resultado sem chamar argon2 na segunda vez
- [x] Unit: revogação invalida o cache na hora

## Critérios de aceite

```bash
# sem chave
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/v1/me           # 401
# chave inválida
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/v1/me -H 'x-api-key: wgw_live_xxx_yyy'   # 401
# chave do seed
curl -s localhost:3001/v1/me -H "x-api-key: $KEY" | jq .                # aplicação e escopos

# rate limit dispara
for i in $(seq 1 200); do curl -s -o /dev/null -w '%{http_code} ' localhost:3001/v1/me -H "x-api-key: $KEY"; done | tr ' ' '\n' | sort | uniq -c   # aparece 429

# cache: 50 requisições em sequência ficam bem abaixo de 50 × custo do argon2
time (for i in $(seq 1 50); do curl -s -o /dev/null localhost:3001/v1/me -H "x-api-key: $KEY"; done)

pnpm test -- api-key                    # unit tests passando
```

- Log de uma requisição autenticada **não** contém a chave em claro.

## Notas

### A ordem dos guards globais era um bug silencioso

O `ApiThrottlerGuard` conta por API key. Registrado como guard global, ele rodava **antes**
do `ApiKeyGuard` (que estava no controller), então `req.apiKey` ainda não existia e o
contador caía sempre no IP — sem erro, sem log, sem sintoma visível.

A correção mudou o desenho: o `ApiKeyGuard` passou a ser **global também**, registrado
antes do throttler. Isso trouxe um benefício maior — a API pública ficou protegida por
padrão. Antes, esquecer um `@UseGuards` numa rota nova a deixaria aberta, e o erro só
apareceria numa auditoria. Agora o opt-out é explícito (`@Public()`), e rotas `/admin` e
`/internal` são puladas por prefixo, porque têm autenticação própria.

### Decisões

- **Recusa genérica para todos os motivos.** Chave inexistente, revogada, expirada e
  aplicação inativa devolvem exatamente a mesma mensagem. Distinguir ajudaria mais quem está
  sondando do que quem está integrando. Há um teste que compara as duas mensagens.
- **O segredo é verificado antes de checar estado.** Sair mais cedo por "revogada" daria, a
  quem tem só o prefixo (que é público), a confirmação de que a chave existiu.
- **Recusa também é cacheada.** Sem isso, uma chave inválida em loop martelaria o banco.
- **`invalidateCache()` limpa tudo**, não a entrada específica: o cache é chaveado pelo
  SHA-256 do valor em claro, que não temos ao revogar (só o hash argon2). O cache é pequeno
  e se repovoa em segundos.
- **`Authorization: Bearer` aceito** além do `X-API-Key`. Muitos clientes HTTP e geradores
  de SDK só sabem mandar credencial nesse header.
- **Escopo faltante é nomeado no erro.** Quem já autenticou conhece a própria chave, então
  não há vazamento — e é o que permite corrigir sem abrir chamado.

### Infraestrutura de teste

Vitest configurado com `unplugin-swc`: o esbuild padrão do Vitest não aplica decorators nem
emite o metadado de tipo que a injeção de dependência do NestJS exige. O config precisou ser
`.mts` — como `.ts` sem `"type": "module"`, o Vite avisava a cada execução.

**39 testes** cobrindo geração, parse, verificação, cache e agrupamento de escritas.

### Verificação executada

```
sem chave / inválida / malformada        401
chave válida (X-API-Key e Bearer)        200
/v1/me                                   aplicação, chave e 6 escopos descritos
erro sem chave                           "Envie sua chave no header X-API-Key..."

cache: 50 requisições autenticadas       630ms total (~12ms cada)
  sem cache seriam ~1150ms só de argon2
rate limit por chave (120/60s)           70x 200 + 20x 429 (acumulando as 50 anteriores)
  contador no Redis                      {hash:default}:hits / :blocked

pnpm test                                39 testes, 2 arquivos, todos passando
pnpm lint / format                       verdes
```
