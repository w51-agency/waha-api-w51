# 19 — Painel: aplicações, chaves, webhooks e auditoria

**Status:** ⬜ pendente
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
- [ ] Lista com nome, slug, situação, nº de sessões, chaves ativas, volume do mês, criada em
- [ ] Criar: nome, descrição, slug editável apenas antes de salvar (é imutável depois)
- [ ] Editar nome/descrição; alternar ativa/inativa com aviso de que as chaves param de funcionar na hora
- [ ] Excluir com confirmação **digitando o slug**, listando o que será apagado junto
- [ ] Detalhe com abas: Chaves, Sessões, Webhooks, Atividade

### API keys
- [ ] Lista: nome, prefixo, escopos, último uso, expira em, situação
- [ ] Criar: nome, escopos (multi-seleção com descrição de cada um), validade opcional
- [ ] **Diálogo de exibição única**: aviso destacado em PT-BR, chave em fonte monoespaçada, botão copiar, checkbox "já copiei" liberando o fechamento; não fecha ao clicar fora nem no Esc
- [ ] Revogar com confirmação, avisando que sistemas usando a chave param imediatamente
- [ ] Rotacionar (revoga e emite nova com os mesmos escopos), passando pelo mesmo diálogo de exibição única
- [ ] Chave nunca visível após a criação — nem parcialmente, além do prefixo
- [ ] Indicador de chave nunca usada e de chave sem uso há muito tempo

### Webhooks
- [ ] Lista de endpoints por aplicação: URL, eventos, situação, taxa de sucesso recente
- [ ] Criar/editar com seleção de eventos e validação de URL
- [ ] Segredo exibido uma única vez (mesmo padrão das chaves)
- [ ] Botão "Enviar teste" com o resultado exibido na hora
- [ ] Tabela de entregas: evento, status, tentativas, código HTTP, duração, quando
- [ ] Detalhe da entrega com payload enviado e resposta recebida
- [ ] Reenviar entrega falha
- [ ] Destaque para endpoints desativados automaticamente, com o motivo e ação de reativar

### Auditoria
- [ ] Linha do tempo paginada, com ícone por tipo de ação
- [ ] Filtros: tipo de ator, ação, recurso, período; busca
- [ ] Descrição legível em PT-BR de cada ação ("Chave 'producao' revogada por admin")
- [ ] Clicar num item leva ao recurso relacionado
- [ ] Metadados e IP visíveis no detalhe
- [ ] Exportar CSV

### Qualidade
- [ ] Nenhum segredo em `localStorage`, log do console ou querystring
- [ ] Todas as ações destrutivas com confirmação proporcional ao estrago
- [ ] Feedback de sucesso e erro consistente com o resto do painel

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

_(preencher durante a execução)_
