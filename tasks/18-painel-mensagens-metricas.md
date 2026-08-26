# 18 — Painel: mensagens e métricas

**Status:** ✅ CONCLUÍDA
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
- [x] Carregar a skill `dataviz` antes de implementar os gráficos
- [x] Definir a paleta e aplicá-la de forma consistente nas duas telas

### Visão geral
- [x] Cartões: números conectados (× total), mensagens hoje, taxa de entrega, alertas ativos
- [x] Gráfico de volume por dia (últimos 30), entrada e saída distinguíveis
- [x] Distribuição por aplicação
- [x] Distribuição de ack (enviado / entregue / lido / falhou)
- [x] Painel de saúde: sessões caídas, webhooks falhando, WAHA fora do ar
- [x] Seletor de período (24h, 7d, 30d, personalizado) afetando a tela toda
- [x] Atualização automática discreta, sem "piscar" a tela

### Mensagens
- [x] Tabela paginada por cursor: data/hora, direção, sessão, número, tipo, prévia, status
- [x] Filtros: sessão, aplicação, direção, tipo, status, período, busca textual (debounced)
- [x] Ícone por tipo e badge de status com rótulo em PT-BR
- [x] Prévia de mídia (miniatura de imagem, player de áudio, link de documento) via proxy `/v1/media/{id}`
- [x] Detalhe em painel lateral: conteúdo completo, metadados, linha do tempo de ack, aplicação e chave que enviaram
- [x] JSON cru visível em aba separada, para depuração
- [x] Exportar CSV respeitando os filtros aplicados
- [x] Novas mensagens chegando via SSE aparecem no topo com indicação sutil
- [x] Estado vazio distinguindo "sem mensagens" de "nenhum resultado para o filtro"

### Qualidade
- [x] Filtros refletidos na URL (compartilhável, sobrevive ao recarregar)
- [x] Gráficos legíveis em tema claro e escuro
- [x] Tabela com scroll horizontal próprio em telas estreitas — a página nunca rola na horizontal
- [x] Skeleton durante o carregamento
- [x] Números formatados em pt-BR (milhar, percentual, data)

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

### A paleta foi computada, não escolhida

A skill `dataviz` insiste que a parte de cor é verificável — então foi verificada com o
script, contra as **superfícies reais do painel** (`#ffffff` no claro, `#13191f` no escuro,
convertida do OKLCH do tema).

```
categórica, entrada x saída
  claro  #2a78d6 / #eb6834   TODOS PASSAM  CVD ΔE 24,7 · visão normal ΔE 33,6
  escuro #3987e5 / #d95926   TODOS PASSAM  CVD ΔE 26,8 · visão normal ΔE 31,8

rampa ordinal do funil de entrega (um só matiz, --ordinal)
  claro  #86b6ef → #2a78d6 → #184f95   monotônica, ΔL ≥ 0,06, extremo claro 2,11:1
  escuro #86b6ef → #3987e5 → #256abf   monotônica, ΔL ≥ 0,06, extremo claro 3,28:1
```

A primeira rampa que montei **reprovou** em três checagens (faixa de luminosidade, piso de
croma, separação para visão normal em ΔE 14,0 — abaixo do piso de 15). Os passos do arquivo
de referência passaram.

Um detalhe do modo escuro: a rampa reprovou contra a superfície `#2b2b2e` que testei
primeiro, e passou contra a superfície real do painel `#13191f`. Testar contra a superfície
errada teria produzido um resultado que parecia validado e não era.

Os valores ficaram como tokens CSS em `index.css`, com o resultado da verificação no
comentário — para que ninguém os troque sem rodar o script de novo.

### SVG à mão em vez de biblioteca de gráficos

As formas necessárias são três: barras agrupadas no tempo, barras horizontais e um funil.
Uma biblioteca custaria ~350 kB para desenhar retângulos. O controle direto também garante
que a paleta validada chegue às marcas **como está**, sem um tema intermediário
reinterpretando as cores.

O `recharts` chegou a ser instalado e foi removido junto do `qrcode` (o QR vem renderizado
do servidor). Pacote final: 162 kB comprimido.

### Formas escolhidas pelo trabalho de cada dado

- **Números conectados, mensagens hoje, taxa de entrega** — cartões, não gráficos. São
  valores únicos; um gráfico ali seria decoração.
- **Volume no tempo** — barras agrupadas, entrada e saída lado a lado com folga de 2px.
- **Entrega** — funil horizontal com rótulo direto em cada etapa. O rótulo direto também
  satisfaz a regra de alívio de contraste da rampa clara.
- **Por aplicação** — barras horizontais, uma série só (sem legenda; o título já a nomeia).

Nenhum gráfico de dois eixos, nenhuma cor por posição em ranking, texto sempre em cor de
texto (a marca ao lado é quem carrega a identidade).

### Alertas só aparecem quando há o que fazer

Um painel que exibe "0 problemas" o tempo todo treina o olho a ignorar aquela área
justamente quando ela passa a importar.

### Token na query: opt-in por rota, verificado

`<img src>`, `<audio src>` e `window.open` **não conseguem** enviar cabeçalhos — é limitação
do navegador. Mas aceitar token na query em toda rota o espalharia pelo log de acesso do
servidor e pelo histórico do navegador.

A solução é um decorator `@AceitaTokenNaQuery()`, aplicado só em GET de mídia e de
exportação. Verificado em execução:

```
/admin/messages/{id}/media?token=   200 (marcada)
/admin/messages/export?token=       200 (marcada)
/admin/sessions?token=              401
/admin/metrics/overview?token=      401
```

### Filtros na URL

O estado da tela de mensagens vive na query do hash: fica compartilhável e sobrevive ao
recarregar — que é o que se espera de uma tela usada para investigar um caso específico.

O estado vazio distingue "nenhum resultado para estes filtros" de "nenhuma mensagem ainda",
porque sugerem ações diferentes.

### Verificação executada

```
validador de paleta            todas as combinações PASSAM nos dois modos
build do painel                162 kB gzip

metrics/overview               200
metrics/messages?granularity   200
metrics/applications           200
messages sem filtro            5 registros
messages direction=INBOUND     21 registros
paginação                      nextCursor presente

escopo do token na query       200 nas 2 rotas marcadas, 401 nas demais

pnpm typecheck / lint / format / build / smoke   todos verdes
```
