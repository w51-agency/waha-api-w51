# 17 — Painel: sessões e QR ao vivo

**Status:** ✅ CONCLUÍDA
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
- [x] Tabela/cards com: número, `pushName`, aplicação de origem, status, conectado desde, última atividade, volume de mensagens
- [x] Badge de status com cor e rótulo em PT-BR (Conectado, Aguardando QR, Parado, Falhou, Iniciando)
- [x] Filtros por status e por aplicação; busca por número ou label
- [x] Atualização ao vivo via SSE, sem recarregar a página
- [x] Estado vazio com chamada para conectar o primeiro número
- [x] Ordenação por status e por data de conexão

### Conectar número
- [x] Botão "Conectar número" abrindo diálogo com escolha da aplicação e label
- [x] Sessão criada e modal de QR aberto na sequência
- [x] **QR renovado automaticamente antes de expirar**, com contador regressivo visível
- [x] SSE muda o modal para sucesso ao conectar, exibindo o número vinculado
- [x] Alternativa por código de pareamento (entrar com o telefone e receber o código)
- [x] Erro e timeout tratados com orientação do que fazer

### Detalhe da sessão
- [x] Página com dados completos, incluindo `qrRequestCount` e `lastQrRequestedAt`
- [x] Linha do tempo de auditoria da sessão (quem pediu QR, quando conectou, quando caiu)
- [x] Mensagens recentes daquela sessão
- [x] Gráfico de volume dos últimos 7 dias
- [x] Ações: iniciar, parar, reiniciar, desconectar, excluir
- [x] Confirmação para ações destrutivas, explicando a consequência em PT-BR
- [x] Desconectar avisa que será preciso escanear o QR novamente

### Detalhes de qualidade
- [x] Número formatado como telefone brasileiro quando aplicável
- [x] Tempo relativo ("há 3 minutos") com tooltip da data absoluta
- [x] Ação otimista com rollback em caso de erro
- [x] Loading por linha, não bloqueando a tabela inteira

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

### O modal de QR tem três mecanismos redundantes de detecção

Esta é a tela onde o produto convence ou frustra, então a detecção da conexão não depende de
um caminho só:

1. **SSE** — reage no instante em que o `session.status = WORKING` chega.
2. **Consulta a cada 5s** — rede de segurança para o caso de o evento se perder.
3. **Renovação do QR aos 17s** — antes dos ~20s em que o WhatsApp gira o código.

O terceiro é o que evita o pior desfecho possível: o usuário escanear um código morto, nada
acontecer, e concluir que o sistema está quebrado. O contador regressivo fica visível, com
"renovando em Ns".

Um 409 com "já está conectada" é tratado como **sucesso**, não erro — porque é o que
significa quando alguém reabre o modal de uma sessão que já conectou.

### Endpoints admin de sessões, reusando o serviço

As rotas `/v1/sessions` são autenticadas por API key e filtradas pela aplicação dona; o
painel precisa do oposto. Em vez de duplicar a lógica — que divergiria na primeira correção —
o `AdminSessionsController` monta uma **identidade sintética** com a aplicação escolhida e
chama o mesmo `SessionsService`.

Isso teve um efeito colateral valioso: o caminho administrativo continua exercitando o filtro
de posse, em vez de contorná-lo.

Um detalhe que quebrou na primeira tentativa: a identidade sintética usava `id: 'painel'`,
que violaria a chave estrangeira de `api_keys` ao gravar `createdByApiKeyId`. Agora usa id
vazio, e o serviço grava `null` — com a auditoria registrando `ADMIN/painel` em vez de
`API_KEY`.

### Confirmações que explicam a consequência

Desconectar e excluir têm textos distintos porque são danos distintos:

- **Desconectar**: "precisará escanear o QR code novamente"; o histórico é preservado.
- **Excluir**: remove do gateway e do WhatsApp, junto de "todo o histórico de mensagens".

Um "Tem certeza?" genérico não ajuda ninguém a decidir.

### A aplicação de origem aparece em cada linha

É o rastreio pedido no `.plan/start.md`, visível: cada número mostra qual sistema o conectou.
O detalhe traz `qrRequestCount` e a linha do tempo completa — quem pediu o QR, quantas vezes,
quando conectou.

### Criar já abre o QR

Criar uma sessão sem conectar não serve para nada, então o diálogo de criação encadeia
direto no modal de QR. Com uma única aplicação ativa, ela já vem selecionada.

### Busca com debounce

300ms. Sem isso, cada tecla dispara uma consulta com `LIKE` no banco.

### Verificação executada

```
build do painel               524 kB (155 kB gzip)
painel                        200
proxy /api/health             ok

endpoints admin usados:
  /admin/sessions             200
  /admin/applications         200
  /admin/messages?limit=5     200
  /admin/metrics/overview     200

criar sessão pelo painel      STARTING, marcada createdVia=DASHBOARD
listar com aplicação          apelido, status, app de origem, contador de QR
QR pelo painel                SCAN_QR_CODE, PNG 5332 bytes, expira em 20s
linha do tempo                session.created e session.qr.requested como ADMIN/painel

pnpm typecheck / lint / format / build / smoke   todos verdes
```

### Pendente de verificação humana

O fluxo completo com celular na mão — escanear e ver o modal trocar para "Número conectado"
— exige um WhatsApp real. Toda a mecânica está implementada e os eventos foram verificados
chegando pelo SSE na tarefa 14; falta a confirmação visual com um aparelho.
