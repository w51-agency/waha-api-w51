# 15 — Documentação OpenAPI completa

**Status:** ⬜ pendente
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
- [ ] Todo DTO com `@ApiProperty`: descrição em PT-BR, `example`, `required`, formato
- [ ] Toda rota com `@ApiOperation` (summary + description) e `@ApiResponse` por status possível
- [ ] Enums documentados com os valores e o significado de cada um
- [ ] `@ApiTags` coerentes: Sessões, Mensagens, Chats & Contatos, Mídia, Webhooks, Conta
- [ ] Descrição de cada tag explicando o conceito antes dos endpoints

### Autenticação e erros
- [ ] `ApiKeyAuth` documentado com formato da chave e como obtê-la
- [ ] Schema `ProblemDetails` referenciado em todas as respostas de erro
- [ ] Catálogo de códigos de erro do domínio, com causa e o que fazer
- [ ] Rate limit documentado, com os headers de resposta

### Exemplos
- [ ] Requisição **e** resposta de exemplo em cada endpoint
- [ ] Múltiplos exemplos onde há variação (mídia por URL × base64 × multipart)
- [ ] Fluxo completo em prosa: criar sessão → QR → conectar → enviar → receber webhook
- [ ] `Idempotency-Key` e paginação por cursor documentados como conceitos, não só como parâmetros

### Artefatos
- [ ] `pnpm openapi:export` gera `docs/openapi.json` e `docs/openapi.yaml`
- [ ] Documento separado para `/admin` em `/docs/admin`
- [ ] `/internal/*` ausente dos dois documentos (verificar)
- [ ] Coleções Insomnia e Postman em `docs/collections/`, com variáveis de ambiente
- [ ] Swagger UI com "Try it out" funcional, incluindo o campo de API key
- [ ] Validação do documento em linter OpenAPI (Spectral) sem erro

### Guia de integração
- [ ] `docs/integracao.md` — passo a passo do zero: obter chave, conectar número, enviar, receber
- [ ] Exemplos em curl, Node (fetch) e PHP
- [ ] Snippet de verificação da assinatura de webhook nas três linguagens
- [ ] Seção de erros comuns e como resolver
- [ ] Boas práticas: retry seguro com idempotência, tratamento de sessão desconectada, rate limit

### CI
- [ ] Script que falha se houver rota pública sem `@ApiOperation`
- [ ] Diff do `openapi.json` visível no PR para flagrar quebra de contrato

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

_(preencher durante a execução)_
