# 05 — Autenticação por API key

**Status:** ⬜ pendente
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
- [ ] `ApiKeyService.generate()`: 32 bytes aleatórios em base62, prefixo de 8 chars, retorna `{ plaintext, prefix, hash }`
- [ ] Hash com `argon2id` (memória 19MiB, 2 iterações, paralelismo 1 — perfil OWASP)
- [ ] `verify(plaintext)`: parse do formato → lookup por `prefix` → argon2.verify → checagem de `revokedAt`/`expiresAt`/`application.active`
- [ ] Retorno genérico (401 "Credencial inválida") para todos os motivos de falha — não revelar se a chave existe, expirou ou foi revogada
- [ ] `revoke(id)` grava `revokedAt` e **invalida o cache imediatamente**

### Cache
- [ ] LRU em memória (`lru-cache`), TTL 60s, teto de entradas configurável
- [ ] Chave do cache = SHA-256 da chave completa (nunca a chave em claro na memória do cache)
- [ ] Invalidação explícita em revogação e em desativação da aplicação
- [ ] `lastUsedAt` atualizado de forma assíncrona e debounced (no máximo 1 escrita/min por chave) — não bloquear a requisição

### Guard e decorators
- [ ] `ApiKeyGuard` lendo `X-API-Key` (aceitar também `Authorization: Bearer` como alternativa documentada)
- [ ] `@CurrentApplication()` — injeta a aplicação resolvida
- [ ] `@CurrentApiKey()` — injeta a chave (para gravar `sentByApiKeyId` e auditoria)
- [ ] `@Scopes('sessions:write')` + `ScopesGuard`
- [ ] `@Public()` para health e docs
- [ ] Escopos definidos: `sessions:read`, `sessions:write`, `messages:read`, `messages:send`, `chats:read`, `webhooks:manage`
- [ ] Chave sem escopos declarados recebe o conjunto completo (padrão conveniente); escopos explícitos restringem

### Rate limit
- [ ] Throttler com storage Redis, chaveado por `apiKey.id` (não por IP)
- [ ] Limites default por `.env`: `RATE_LIMIT_TTL`, `RATE_LIMIT_LIMIT`
- [ ] Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` na resposta
- [ ] 429 no formato problem+json

### Auditoria
- [ ] Todo uso de chave em operação de escrita gera `AuditLog` com `actorType: API_KEY`
- [ ] Tentativa de autenticação falha é logada (com o prefixo, jamais a chave inteira)

### Testes
- [ ] Unit: geração → verificação bate; chave adulterada falha; chave revogada falha; expirada falha
- [ ] Unit: cache devolve resultado sem chamar argon2 na segunda vez
- [ ] Unit: revogação invalida o cache na hora

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

_(preencher durante a execução)_
