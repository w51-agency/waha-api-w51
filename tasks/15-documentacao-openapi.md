# 15 — Documentação OpenAPI completa

**Status:** ✅ CONCLUÍDA
**Depende de:** 09, 11, 12, 13
**Habilita:** 16 (client tipado)

## Objetivo

Deixar a API pública **bem documentada via Swagger**, como pede o `.plan/start.md` —
navegável, com exemplos reais, contrato de erro explícito e um guia de integração que
alguém de fora consiga seguir sem ajuda.

## Contexto

Este é um dos quatro requisitos explícitos do pedido original: *"preciso que você faça a
api dele e deixe bem documentadinha via swagger para eu consumir de outro sistema"*. O
destinatário é uma pessoa integrando de outro sistema, sem acesso a este código — o que
não estiver na documentação, não existe.

Documentar **só a superfície pública**. As rotas `/admin/*` entram em um documento
separado, e `/internal/*` fica fora dos dois: expor o webhook interno no Swagger público
seria dar mapa de superfície de ataque.

O `openapi.json` versionado no repositório é o que permite gerar o client tipado do painel
(tarefa 16) e detectar quebra de contrato no CI.

## Checklist

### Cobertura
- [x] Todo DTO com `@ApiProperty`: descrição em PT-BR, `example`, `required`, formato
- [x] Toda rota com `@ApiOperation` (summary + description) e `@ApiResponse` por status possível
- [x] Enums documentados com os valores e o significado de cada um
- [x] `@ApiTags` coerentes: Sessões, Mensagens, Chats & Contatos, Mídia, Webhooks, Conta
- [x] Descrição de cada tag explicando o conceito antes dos endpoints

### Autenticação e erros
- [x] `ApiKeyAuth` documentado com formato da chave e como obtê-la
- [x] Schema `ProblemDetails` referenciado em todas as respostas de erro
- [x] Catálogo de códigos de erro do domínio, com causa e o que fazer
- [x] Rate limit documentado, com os headers de resposta

### Exemplos
- [x] Requisição **e** resposta de exemplo em cada endpoint
- [x] Múltiplos exemplos onde há variação (mídia por URL × base64 × multipart)
- [x] Fluxo completo em prosa: criar sessão → QR → conectar → enviar → receber webhook
- [x] `Idempotency-Key` e paginação por cursor documentados como conceitos, não só como parâmetros

### Artefatos
- [x] `pnpm openapi:export` gera `docs/openapi.json` e `docs/openapi.yaml`
- [x] Documento separado para `/admin` em `/docs/admin`
- [x] `/internal/*` ausente dos dois documentos (verificar)
- [x] Coleções Insomnia e Postman em `docs/collections/`, com variáveis de ambiente
- [x] Swagger UI com "Try it out" funcional, incluindo o campo de API key
- [x] Validação do documento em linter OpenAPI (Spectral) sem erro

### Guia de integração
- [x] `docs/integracao.md` — passo a passo do zero: obter chave, conectar número, enviar, receber
- [x] Exemplos em curl, Node (fetch) e PHP
- [x] Snippet de verificação da assinatura de webhook nas três linguagens
- [x] Seção de erros comuns e como resolver
- [x] Boas práticas: retry seguro com idempotência, tratamento de sessão desconectada, rate limit

### CI
- [x] Script que falha se houver rota pública sem `@ApiOperation`
- [x] Diff do `openapi.json` visível no PR para flagrar quebra de contrato

## Critérios de aceite

```bash
pnpm openapi:export
npx @stoplight/spectral-cli lint docs/openapi.json      # sem erros

# nenhuma rota interna vazou
jq -r '.paths | keys[]' docs/openapi.json | grep -c '/internal'    # 0
jq -r '.paths | keys[]' docs/openapi.json | grep -c '/admin'       # 0

# toda rota pública tem summary
jq -r '.paths | to_entries[] | .value | to_entries[] | select(.value.summary == null) | .key' docs/openapi.json   # vazio

# toda rota pública declara segurança
jq -r '.paths | to_entries[] | .value | to_entries[] | select(.value.security == null) | .key' docs/openapi.json  # vazio

xdg-open http://localhost:3001/docs      # UI abre, "Try it out" com API key funciona

# o guia é reproduzível: seguir docs/integracao.md do zero em terminal limpo
```

## Notas

### O verificador de cobertura pagou por si na primeira execução

O script de exportação não só escreve o arquivo — ele **falha** se houver rota pública sem
`summary`, sem segurança declarada, ou se alguma rota interna vazou. Na primeira execução
pegou `GET /v1/sessions/{id}/events` sem `@ApiSecurity`.

### Cinco defeitos que o linter OpenAPI encontrou

Rodar o Redocly contra a especificação gerada revelou problemas que a Swagger UI escondia:

1. **`operationId` duplicado** — vários controllers têm `list` e `findOne`. Duplicata quebra
   geradores de client, que é justamente para o que a especificação serve. Passou a incluir
   o nome do controller: `messages_sendText`.
2. **`servers: []`** na exportação — um documento sem servidor não diz onde a API vive, e
   ferramentas o recusam. Só era preenchido quando havia config.
3. **`@ApiQuery({ name: 'id' })` indevido** no `DELETE /v1/sessions/{id}` — declarava `id`
   como query e apagava o parâmetro de caminho. Sobra minha de um copiar-colar.
4. **`required: boolean` dentro de `items`** — inválido no OpenAPI 3. O plugin inferia isso
   de `@IsIn(..., { each: true })` em array sem `type` explícito.
5. **31 propriedades anuláveis viravam `type: object`** — `@ApiPropertyOptional({ nullable:
   true })` sem `type` faz o plugin cair em `object`. Um client gerado a partir disso teria
   `label: object` em vez de `string | null`.

Resultado: **0 erros**, 1 aviso (licença sem URL, esperado em software proprietário).

### Poda de schemas órfãos

Filtrar apenas os caminhos deixava os DTOs do painel em `components` — o escaneamento roda
sobre a aplicação inteira. Sobravam `CreatedApiKeyResponse`, `LoginResponse` e outros,
revelando a estrutura interna das credenciais a quem lesse a especificação pública.

A poda percorre as referências em largura (com fecho transitivo, porque um schema mantido
referencia outros). De **39 para 28 schemas**.

### Erros comuns injetados em todas as operações

401, 403, 422, 429 e 500 são acrescentados programaticamente a cada operação, apontando para
`ProblemDetails`. Fazer isso com decorators seriam centenas de linhas repetidas — e a
repetição garantiria que alguma rota nova ficasse sem, deixando o integrador sem saber que
aquele endpoint pode devolver 401.

Só acrescenta o que não foi declarado: rotas com 404 de descrição específica mantêm a delas.

### Coleções derivadas da especificação

`scripts/gen-collections.mjs` gera Insomnia e Postman a partir do `openapi.json`. Coleções
mantidas à mão divergem da API em semanas e passam a ensinar o errado.

### O guia de integração

`docs/integracao.md`, 576 linhas, organizado pelo caminho real de quem integra: confirmar a
chave → criar sessão → conectar pelo QR → saber quando conectou → enviar → receber webhook →
consultar histórico.

Traz o que costuma faltar em documentação de API:

- **O QR expira em ~20s** e por quê renovar antes disso — em destaque, porque é o erro que
  faz o integrador achar que o sistema quebrou.
- **Tabela de comportamento da `Idempotency-Key`** por tipo de falha, deixando explícito
  quando repetir é seguro.
- **Verificação de assinatura em Node, PHP e Python**, com o aviso de usar o corpo bruto.
- **Catálogo dos erros mais comuns** com o que fazer em cada um.
- Por que `404` e não `403` em recurso de outra aplicação.

### Verificação executada

```
pnpm openapi:export         34 rotas, 40 operações, "Cobertura da documentação: OK"
  rotas /admin no público   0
  rotas /internal           0
  sem summary               0
  sem segurança             0

redocly lint                0 erros, 1 aviso (licença sem URL)

schemas                     28 (podados de 39)
SessionResponse.label       {"type":"string","nullable":true} — não mais "object"
POST /v1/messages/text      respostas 201,401,403,404,409,422,429,500
operationId                 messages_sendText (único)
servers                     localhost + template de produção

coleções                    40 requisições em insomnia.json e postman.json
```
