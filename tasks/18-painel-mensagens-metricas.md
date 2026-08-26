# 18 — Painel: mensagens e métricas

**Status:** ⬜ pendente
**Depende de:** 12, 14, 16
**Habilita:** —

## Objetivo

As telas de **mensagens enviadas e recebidas** e o dashboard de **visão geral** com
gráficos — a outra metade do "vejo as mensagens enviadas e tudo mais" do `.plan/start.md`.

## Contexto

Duas telas com propósitos distintos: a Visão geral responde "está tudo bem?" em cinco
segundos; a tela de Mensagens responde "o que aconteceu com esta mensagem específica?".

Antes de escrever qualquer código de gráfico, **carregar a skill `dataviz`** — ela define a
paleta, o tipo de marca por pergunta e as regras de eixo/legenda que mantêm os gráficos
legíveis nos dois temas.

Duas armadilhas de performance: a tabela de mensagens cresce sem limite, então a paginação
por cursor da tarefa 12 tem que ser respeitada (nada de carregar tudo e filtrar no cliente);
e o filtro de busca precisa ser debounced, senão cada tecla vira uma consulta com `LIKE`.

## Checklist

### Preparação
- [ ] Carregar a skill `dataviz` antes de implementar os gráficos
- [ ] Definir a paleta e aplicá-la de forma consistente nas duas telas

### Visão geral
- [ ] Cartões: números conectados (× total), mensagens hoje, taxa de entrega, alertas ativos
- [ ] Gráfico de volume por dia (últimos 30), entrada e saída distinguíveis
- [ ] Distribuição por aplicação
- [ ] Distribuição de ack (enviado / entregue / lido / falhou)
- [ ] Painel de saúde: sessões caídas, webhooks falhando, WAHA fora do ar
- [ ] Seletor de período (24h, 7d, 30d, personalizado) afetando a tela toda
- [ ] Atualização automática discreta, sem "piscar" a tela

### Mensagens
- [ ] Tabela paginada por cursor: data/hora, direção, sessão, número, tipo, prévia, status
- [ ] Filtros: sessão, aplicação, direção, tipo, status, período, busca textual (debounced)
- [ ] Ícone por tipo e badge de status com rótulo em PT-BR
- [ ] Prévia de mídia (miniatura de imagem, player de áudio, link de documento) via proxy `/v1/media/{id}`
- [ ] Detalhe em painel lateral: conteúdo completo, metadados, linha do tempo de ack, aplicação e chave que enviaram
- [ ] JSON cru visível em aba separada, para depuração
- [ ] Exportar CSV respeitando os filtros aplicados
- [ ] Novas mensagens chegando via SSE aparecem no topo com indicação sutil
- [ ] Estado vazio distinguindo "sem mensagens" de "nenhum resultado para o filtro"

### Qualidade
- [ ] Filtros refletidos na URL (compartilhável, sobrevive ao recarregar)
- [ ] Gráficos legíveis em tema claro e escuro
- [ ] Tabela com scroll horizontal próprio em telas estreitas — a página nunca rola na horizontal
- [ ] Skeleton durante o carregamento
- [ ] Números formatados em pt-BR (milhar, percentual, data)

## Critérios de aceite

Fluxo manual no navegador:

1. **Visão geral** carrega em menos de 2s com dados reais; alternar o período recalcula tudo.
2. Gráficos legíveis nos dois temas; alternar tema não quebra cor nem contraste.
3. **Mensagens**: rolar até o fim carrega a próxima página sem repetir nem pular registros.
4. Filtrar por sessão e direção reduz o conjunto corretamente; a URL reflete os filtros e sobrevive ao F5.
5. Clicar numa mensagem abre o detalhe com **a aplicação e a chave que a enviaram**.
6. Mídia é exibida na prévia (imagem abre, áudio toca).
7. Enviar uma mensagem por `curl` → ela aparece na tabela em segundos, sem recarregar.
8. Exportar CSV baixa o arquivo com as colunas certas e apenas as linhas filtradas.

```bash
# volume conferido contra o banco
curl -s "localhost:3001/admin/metrics/messages?granularity=day&from=$(date -d '7 days ago' +%F)" \
  -H "authorization: Bearer $TOKEN" | jq '[.series[].total] | add'
docker compose exec postgres psql -U gateway -d gateway -t \
  -c "select count(*) from messages where timestamp > now() - interval '7 days';"
# os dois números batem

pnpm typecheck && pnpm lint && pnpm build
```

## Notas

_(preencher durante a execução)_
