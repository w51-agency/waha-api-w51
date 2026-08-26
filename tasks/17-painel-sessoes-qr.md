# 17 — Painel: sessões e QR ao vivo

**Status:** ⬜ pendente
**Depende de:** 09, 14, 16
**Habilita:** —

## Objetivo

A tela principal do painel: a lista dos **números conectados**, com status ao vivo, e o
fluxo de conectar um número novo pelo QR code que se atualiza sozinho quando a conexão é
estabelecida.

## Contexto

É a primeira coisa que o `.plan/start.md` pede — *"um painel onde eu vejo os números
conectados"* — e a tela que será mais usada no dia a dia.

O que decide a qualidade dessa tela é o **modal do QR**. Sem tempo real, o usuário escaneia
e fica olhando para um QR morto sem saber se funcionou. Com o SSE da tarefa 14, o modal
troca para o estado de sucesso no instante em que o `session.status = WORKING` chega,
exibindo o número que acabou de conectar. Além disso, o QR do WhatsApp **expira em torno de
20 segundos** — a tela precisa buscar um novo automaticamente, com contador visível, senão o
usuário escaneia um código morto e conclui que o sistema está quebrado.

Cada sessão precisa mostrar **de qual aplicação ela é** — é o rastreio pedido no
`.plan/start.md`, visível.

## Checklist

### Lista de sessões
- [ ] Tabela/cards com: número, `pushName`, aplicação de origem, status, conectado desde, última atividade, volume de mensagens
- [ ] Badge de status com cor e rótulo em PT-BR (Conectado, Aguardando QR, Parado, Falhou, Iniciando)
- [ ] Filtros por status e por aplicação; busca por número ou label
- [ ] Atualização ao vivo via SSE, sem recarregar a página
- [ ] Estado vazio com chamada para conectar o primeiro número
- [ ] Ordenação por status e por data de conexão

### Conectar número
- [ ] Botão "Conectar número" abrindo diálogo com escolha da aplicação e label
- [ ] Sessão criada e modal de QR aberto na sequência
- [ ] **QR renovado automaticamente antes de expirar**, com contador regressivo visível
- [ ] SSE muda o modal para sucesso ao conectar, exibindo o número vinculado
- [ ] Alternativa por código de pareamento (entrar com o telefone e receber o código)
- [ ] Erro e timeout tratados com orientação do que fazer

### Detalhe da sessão
- [ ] Página com dados completos, incluindo `qrRequestCount` e `lastQrRequestedAt`
- [ ] Linha do tempo de auditoria da sessão (quem pediu QR, quando conectou, quando caiu)
- [ ] Mensagens recentes daquela sessão
- [ ] Gráfico de volume dos últimos 7 dias
- [ ] Ações: iniciar, parar, reiniciar, desconectar, excluir
- [ ] Confirmação para ações destrutivas, explicando a consequência em PT-BR
- [ ] Desconectar avisa que será preciso escanear o QR novamente

### Detalhes de qualidade
- [ ] Número formatado como telefone brasileiro quando aplicável
- [ ] Tempo relativo ("há 3 minutos") com tooltip da data absoluta
- [ ] Ação otimista com rollback em caso de erro
- [ ] Loading por linha, não bloqueando a tabela inteira

## Critérios de aceite

Fluxo manual completo no navegador:

1. Abrir **Sessões** — lista carrega, estado vazio se não houver nada.
2. "Conectar número" → escolher aplicação → QR aparece com contador.
3. Deixar o QR expirar → um novo é buscado sozinho, sem intervenção.
4. Escanear com o celular → **o modal troca para sucesso em poucos segundos, mostrando o número**, sem recarregar a página.
5. A lista já mostra o número conectado com a aplicação de origem.
6. Abrir o detalhe → `qrRequestCount` reflete os pedidos, auditoria mostra a linha do tempo.
7. Parar a sessão → status muda ao vivo para "Parado".
8. Reiniciar → volta para "Aguardando QR".
9. Excluir com confirmação → some da lista e do WAHA (conferir com `curl` no WAHA).

```bash
# a sessão realmente sumiu do WAHA
curl -s localhost:3000/api/sessions -H "x-api-key: $WAHA_API_KEY" | jq -r '.[].name'
pnpm typecheck && pnpm lint
```

## Notas

_(preencher durante a execução)_
