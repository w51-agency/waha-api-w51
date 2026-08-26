# 08 — Aplicações e API keys (admin)

**Status:** ✅ CONCLUÍDA
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
- [x] `POST /admin/applications` — `{ name, slug?, description? }`; slug derivado do nome se ausente, único, normalizado (minúsculas, sem acento, hífens)
- [x] `GET /admin/applications` — lista com contagem de sessões, chaves ativas e mensagens do mês
- [x] `GET /admin/applications/{id}` — detalhe com chaves e sessões vinculadas
- [x] `PATCH /admin/applications/{id}` — `name`, `description`, `active`
- [x] `DELETE /admin/applications/{id}` — exige `?confirm={slug}`; faz logout e remove as sessões no WAHA antes do cascade
- [x] Desativar invalida o cache de todas as chaves da aplicação na hora

### API keys
- [x] `POST /admin/applications/{id}/api-keys` — `{ name, scopes?, expiresAt? }`
- [x] Resposta inclui `secret` **uma única vez**, com aviso em PT-BR de que não será exibido de novo
- [x] `GET /admin/applications/{id}/api-keys` — nunca devolve `hash` nem `secret`; mostra `prefix`, `name`, `scopes`, `lastUsedAt`, `expiresAt`, `revokedAt`
- [x] `DELETE /admin/api-keys/{id}` — revoga (soft, grava `revokedAt`), não apaga: o histórico precisa continuar apontando para ela
- [x] `POST /admin/api-keys/{id}/rotate` — revoga a atual e emite uma nova com os mesmos escopos, em uma transação
- [x] Revogação invalida o cache imediatamente

### Regras
- [x] Slug imutável após a criação (é usado no nome da sessão no WAHA)
- [x] Não permitir revogar a última chave ativa sem confirmação explícita (evita perder acesso sem querer)
- [x] Toda operação gera `AuditLog` com `actorType: ADMIN`

### Documentação
- [x] DTOs anotados com `@ApiProperty` e exemplos
- [x] Endpoints marcados com a tag `Admin` e `BearerAuth`

### Testes
- [x] e2e: criar aplicação → criar chave → chave autentica em `/v1/me`
- [x] e2e: revogar chave → `/v1/me` passa a devolver 401 **imediatamente**
- [x] e2e: desativar aplicação → chaves param de funcionar imediatamente
- [x] e2e: `GET` de chaves nunca traz `hash` nem `secret`
- [x] e2e: slug duplicado devolve 409

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

### Serialização explícita, não espalhamento de objeto

`toApiKeyResponse` monta a resposta campo a campo em vez de espalhar o registro do Prisma.
É mais verboso de propósito: com espalhamento, um campo sensível novo no schema vazaria
automaticamente na resposta, e ninguém perceberia até alguém olhar. Verificado — a listagem
devolve exatamente `active, createdAt, expiresAt, id, lastUsedAt, name, prefix, revokedAt,
scopes`, sem `hash` nem `secret`.

### Confirmações proporcionais ao estrago

Três operações destrutivas, três níveis de atrito:

- **Revogar uma chave qualquer** — direto. É reversível emitindo outra.
- **Revogar a última chave ativa** — 409 explicando que a aplicação ficará sem acesso, com
  `?force=true` para confirmar. Costuma ser engano; nunca é impedido.
- **Excluir a aplicação** — exige `?confirm=<slug>`, porque o cascade apaga sessões e todo o
  histórico de mensagens.

### Rotação em transação

Revogar e emitir em passos separados deixaria a aplicação sem acesso se o segundo falhasse.
`$transaction` garante que ou as duas acontecem, ou nenhuma.

### Invalidação do cache em três pontos

Revogação, rotação e desativação da aplicação chamam `invalidateCache()`. Sem isso, a
credencial continuaria valendo por até 60 s — e o motivo de revogar costuma ser justamente
conter um vazamento. Verificado em execução: 200 antes, **401 imediatamente depois**.

### Auditoria com serviço próprio

`AuditService` foi criado aqui (a tarefa 14 previa) porque cada operação desta tarefa precisa
registrar. Ele **nunca propaga erro**: auditoria que derruba a operação auditada é pior que
auditoria ausente.

O `metadata` guarda o **prefixo** da chave, nunca o segredo.

### Contagens sem N+1

`_count` do Prisma só conta relações inteiras, e a listagem precisa de contagens filtradas
(chaves ativas, sessões conectadas, mensagens dos últimos 30 dias). Três `groupBy` paralelos
resolvem em consultas fixas, independentemente do número de aplicações.

### Verificação executada

```
criar aplicação                       slug derivado: "CRM Vendas" -> crm-vendas
slug duplicado                        409
emitir chave                          secret exibido + aviso; autentica em /v1/me (200)
listar chaves                         sem secret, sem hash
escopos restritos                     ['messages:send'] preservado

revogação                             200 antes -> 401 imediatamente depois
última chave ativa                    409 pedindo ?force=true
rotação                               nova chave 200 / antiga 401
desativar aplicação                   401 na hora; reativar -> 200
excluir sem confirmação               422 informando o slug esperado
excluir com ?confirm=<slug>           {deleted: true, sessionsRemoved: 0}

auditoria                             8 registros: application.created, apikey.created x2,
                                      apikey.revoked, apikey.rotated,
                                      application.deactivated/activated, application.deleted
```
