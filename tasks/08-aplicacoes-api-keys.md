# 08 — Aplicações e API keys (admin)

**Status:** ⬜ pendente
**Depende de:** 05, 06
**Habilita:** 09, 19

## Objetivo

Expor no painel administrativo o CRUD de **aplicações** (os sistemas integradores) e das
suas **API keys** — criar, listar, revogar — com o segredo exibido uma única vez, no
momento da criação.

## Contexto

É aqui que a frase do `.plan/start.md` — *"preciso poder criar api key para os sistemas se
conectarem nele"* — vira endpoint. Cada `Application` representa um sistema que vai
consumir o gateway; as chaves são as credenciais dele.

Regra inegociável: **o segredo em claro existe apenas na resposta do POST de criação.**
Depois disso só resta o hash argon2id, e nem o admin consegue recuperá-lo — perdeu, gera
outra. A resposta de criação deve deixar isso explícito em PT-BR, porque é a única chance
de copiar.

Desativar uma aplicação (`active: false`) precisa derrubar o acesso **imediatamente**,
invalidando o cache de chaves da tarefa 05 — senão a chave continua funcionando por até
60s. Excluir uma aplicação é destrutivo: apaga sessões (com logout no WAHA) e histórico
em cascata, então exige confirmação por nome.

## Checklist

### Aplicações
- [ ] `POST /admin/applications` — `{ name, slug?, description? }`; slug derivado do nome se ausente, único, normalizado (minúsculas, sem acento, hífens)
- [ ] `GET /admin/applications` — lista com contagem de sessões, chaves ativas e mensagens do mês
- [ ] `GET /admin/applications/{id}` — detalhe com chaves e sessões vinculadas
- [ ] `PATCH /admin/applications/{id}` — `name`, `description`, `active`
- [ ] `DELETE /admin/applications/{id}` — exige `?confirm={slug}`; faz logout e remove as sessões no WAHA antes do cascade
- [ ] Desativar invalida o cache de todas as chaves da aplicação na hora

### API keys
- [ ] `POST /admin/applications/{id}/api-keys` — `{ name, scopes?, expiresAt? }`
- [ ] Resposta inclui `secret` **uma única vez**, com aviso em PT-BR de que não será exibido de novo
- [ ] `GET /admin/applications/{id}/api-keys` — nunca devolve `hash` nem `secret`; mostra `prefix`, `name`, `scopes`, `lastUsedAt`, `expiresAt`, `revokedAt`
- [ ] `DELETE /admin/api-keys/{id}` — revoga (soft, grava `revokedAt`), não apaga: o histórico precisa continuar apontando para ela
- [ ] `POST /admin/api-keys/{id}/rotate` — revoga a atual e emite uma nova com os mesmos escopos, em uma transação
- [ ] Revogação invalida o cache imediatamente

### Regras
- [ ] Slug imutável após a criação (é usado no nome da sessão no WAHA)
- [ ] Não permitir revogar a última chave ativa sem confirmação explícita (evita perder acesso sem querer)
- [ ] Toda operação gera `AuditLog` com `actorType: ADMIN`

### Documentação
- [ ] DTOs anotados com `@ApiProperty` e exemplos
- [ ] Endpoints marcados com a tag `Admin` e `BearerAuth`

### Testes
- [ ] e2e: criar aplicação → criar chave → chave autentica em `/v1/me`
- [ ] e2e: revogar chave → `/v1/me` passa a devolver 401 **imediatamente**
- [ ] e2e: desativar aplicação → chaves param de funcionar imediatamente
- [ ] e2e: `GET` de chaves nunca traz `hash` nem `secret`
- [ ] e2e: slug duplicado devolve 409

## Critérios de aceite

```bash
TOKEN=$(curl -s -XPOST localhost:3001/admin/auth/login -H 'content-type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" | jq -r .accessToken)

APP=$(curl -s -XPOST localhost:3001/admin/applications -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"CRM Vendas"}' | jq -r .id)

KEY=$(curl -s -XPOST localhost:3001/admin/applications/$APP/api-keys -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"producao"}' | jq -r .secret)
echo "$KEY"                                        # wgw_live_xxxxxxxx_...

curl -s localhost:3001/v1/me -H "x-api-key: $KEY" | jq .        # autentica

# o segredo não volta em listagem
curl -s localhost:3001/admin/applications/$APP/api-keys -H "authorization: Bearer $TOKEN" \
  | jq '.[0] | has("secret"), has("hash")'         # false false

# revogação é imediata
KID=$(curl -s localhost:3001/admin/applications/$APP/api-keys -H "authorization: Bearer $TOKEN" | jq -r '.[0].id')
curl -s -XDELETE localhost:3001/admin/api-keys/$KID -H "authorization: Bearer $TOKEN"
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/v1/me -H "x-api-key: $KEY"   # 401 na hora

pnpm test:e2e -- applications
```

## Notas

_(preencher durante a execução)_
