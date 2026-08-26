# 19 — Painel: aplicações, chaves, webhooks e auditoria

**Status:** ✅ CONCLUÍDA
**Depende de:** 08, 13, 14, 16
**Habilita:** —

## Objetivo

Fechar o painel com as telas de gestão: cadastrar sistemas integradores, emitir e revogar
API keys, acompanhar os webhooks de saída e consultar a trilha de auditoria.

## Contexto

Aqui o requisito *"preciso poder criar api key para os sistemas se conectarem"* ganha
interface. A tela mais delicada é a de emissão de chave: **o segredo aparece uma única vez**
e, se o usuário fechar o diálogo sem copiar, perdeu — precisa gerar outra. O desenho tem que
tornar isso impossível de ignorar: aviso claro, botão de copiar em destaque, confirmação
antes de fechar, e o diálogo não fecha ao clicar fora.

A tela de auditoria é o que responde, meses depois, "quem conectou este número e quando".

## Checklist

### Aplicações
- [x] Lista com nome, slug, situação, nº de sessões, chaves ativas, volume do mês, criada em
- [x] Criar: nome, descrição, slug editável apenas antes de salvar (é imutável depois)
- [x] Editar nome/descrição; alternar ativa/inativa com aviso de que as chaves param de funcionar na hora
- [x] Excluir com confirmação **digitando o slug**, listando o que será apagado junto
- [x] Detalhe com abas: Chaves, Sessões, Webhooks, Atividade

### API keys
- [x] Lista: nome, prefixo, escopos, último uso, expira em, situação
- [x] Criar: nome, escopos (multi-seleção com descrição de cada um), validade opcional
- [x] **Diálogo de exibição única**: aviso destacado em PT-BR, chave em fonte monoespaçada, botão copiar, checkbox "já copiei" liberando o fechamento; não fecha ao clicar fora nem no Esc
- [x] Revogar com confirmação, avisando que sistemas usando a chave param imediatamente
- [x] Rotacionar (revoga e emite nova com os mesmos escopos), passando pelo mesmo diálogo de exibição única
- [x] Chave nunca visível após a criação — nem parcialmente, além do prefixo
- [x] Indicador de chave nunca usada e de chave sem uso há muito tempo

### Webhooks
- [x] Lista de endpoints por aplicação: URL, eventos, situação, taxa de sucesso recente
- [x] Criar/editar com seleção de eventos e validação de URL
- [x] Segredo exibido uma única vez (mesmo padrão das chaves)
- [x] Botão "Enviar teste" com o resultado exibido na hora
- [x] Tabela de entregas: evento, status, tentativas, código HTTP, duração, quando
- [x] Detalhe da entrega com payload enviado e resposta recebida
- [x] Reenviar entrega falha
- [x] Destaque para endpoints desativados automaticamente, com o motivo e ação de reativar

### Auditoria
- [x] Linha do tempo paginada, com ícone por tipo de ação
- [x] Filtros: tipo de ator, ação, recurso, período; busca
- [x] Descrição legível em PT-BR de cada ação ("Chave 'producao' revogada por admin")
- [x] Clicar num item leva ao recurso relacionado
- [x] Metadados e IP visíveis no detalhe
- [x] Exportar CSV

### Qualidade
- [x] Nenhum segredo em `localStorage`, log do console ou querystring
- [x] Todas as ações destrutivas com confirmação proporcional ao estrago
- [x] Feedback de sucesso e erro consistente com o resto do painel

## Critérios de aceite

Fluxo manual no navegador:

1. Criar aplicação "ERP Financeiro" → aparece na lista com slug gerado.
2. Emitir chave → **diálogo de exibição única** abre; tentar fechar clicando fora **não** fecha; copiar e confirmar libera.
3. Usar a chave copiada em `curl` → autentica.
4. Recarregar a tela de chaves → a chave **não** é exibida, só o prefixo.
5. Revogar → o mesmo `curl` passa a devolver 401 **imediatamente**.
6. Cadastrar webhook e enviar teste → resultado aparece na tela e a entrega é registrada.
7. Derrubar o receptor e disparar de novo → tentativas incrementam e o status vira "retentando".
8. Reenviar manualmente com o receptor de pé → sucesso.
9. Auditoria mostra tudo acima em ordem, com descrições legíveis.
10. Desativar a aplicação → sessões e chaves param; reativar restaura.

```bash
curl -s localhost:3001/v1/me -H "x-api-key: $CHAVE_COPIADA_DO_PAINEL" | jq .   # antes: 200
# revogar no painel
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/v1/me -H "x-api-key: $CHAVE_COPIADA_DO_PAINEL"  # 401

pnpm typecheck && pnpm lint && pnpm build
```

## Notas

### O diálogo de exibição única é a tela mais delicada do painel

O segredo **não é recuperável**. Fechar sem copiar significa perder a credencial e ter que
emitir outra — trabalho real jogado fora por um clique errado. Por isso:

- **Travado**: não fecha ao clicar fora nem com Esc.
- **Confirmação explícita**: um checkbox — "Guardei este valor em local seguro" — libera o
  botão de concluir.
- **Botão de copiar em destaque**, com retorno visual de "Copiado".
- Alternativa de cópia para contexto não seguro: `navigator.clipboard` só existe em HTTPS ou
  localhost, e o painel pode rodar em HTTP numa rede interna.

O mesmo componente serve chaves de API e segredos de webhook — os dois têm exatamente o
mesmo problema.

### Confirmações proporcionais ao estrago

Três níveis, deliberadamente distintos:

| Ação | Atrito | Por quê |
|---|---|---|
| Revogar chave | confirmação simples | reversível emitindo outra |
| Revogar a **última** chave ativa | a API devolve 409, o painel troca o botão para "Revogar mesmo assim" | deixa a aplicação sem acesso |
| Excluir aplicação | **digitar o slug**, com a lista do que será apagado | o cascade leva sessões e todo o histórico |

O diálogo de exclusão enumera as contagens reais — "3 sessões, 2 chaves, todo o histórico" —
em vez de um "tem certeza?" que não ajuda ninguém a decidir.

### Rotação avisa antes, não depois

O texto diz "atualize o sistema integrador com o valor novo **antes de concluir** — o acesso
é interrompido no mesmo instante". Quem descobre isso depois já derrubou a integração.

### `GATEWAY_EVENTS` migrou para `shared`

A lista vivia só na API, e o painel precisava dela para o seletor de eventos. Duplicá-la
faria as duas divergirem na primeira adição. Movida para `@gateway/shared`, com o módulo da
API reexportando para manter os imports locais.

### Segredo de webhook não vaza na listagem

O controller admin desestrutura o campo fora explicitamente. Verificado: a resposta traz
`active, application, applicationId, consecutiveFailures, createdAt, description, disabledAt,
disabledReason, events, id, updatedAt, url` — sem `secret`.

### A auditoria leva ao recurso

Cada registro tem atalho para a sessão ou aplicação envolvida. Uma trilha que só descreve o
que aconteceu, sem levar ao objeto, obriga a caçar o id na mão — e aí ninguém a usa.

Tentativas de login recusadas ganham badge própria: uma sequência delas é o sinal de que
alguém está tentando entrar.

### Verificação executada

```
GET /admin/applications        200
GET /admin/webhook-endpoints   200
GET /admin/audit-logs          200

segredo do webhook na listagem  ausente (verificado campo a campo)

fluxo completo:
  chave emitida autentica       200
  revogar última chave          409 (exige confirmação)
  revogar com force=true        200
  chave revogada                401 imediatamente

webhook admin:
  criar                         secret exibido uma vez
  testar                        entrega registrada
  listar entregas               ok

auditoria                       "Chave k1 revogada por admin",
                                "Aplicação Teste Tarefa 19 criada por admin",
                                "Login no painel por admin"

pnpm test                       150 testes
pnpm typecheck / lint / format / build / smoke   todos verdes
```
