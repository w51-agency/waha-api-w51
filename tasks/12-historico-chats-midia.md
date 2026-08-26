# 12 — Histórico, chats e proxy de mídia

**Status:** ✅ CONCLUÍDA
**Depende de:** 10, 11
**Habilita:** 18

## Objetivo

Expor a consulta ao que o gateway já registrou (histórico de mensagens com filtros e
paginação por cursor), a leitura ao vivo de chats e contatos via store do NOWEB, e um
proxy autenticado de mídia — para que o WAHA permaneça inacessível de fora.

## Contexto

Duas fontes de dados convivem aqui, e a distinção importa:

- **Nosso Postgres** guarda tudo que passou pelo gateway desde que a sessão foi criada.
  É a fonte para relatórios, auditoria e para o painel.
- **O store do NOWEB** (habilitado na criação da sessão, tarefa 09) guarda o que o WhatsApp
  sincronizou naquele dispositivo — inclusive conversas anteriores à conexão. É a fonte para
  "listar meus chats" e "buscar contato".

**Paginação por cursor, não por offset.** Mensagens chegam o tempo todo; `OFFSET` em tabela
que cresce durante a navegação pula e repete registros, e degrada em tabela grande. Cursor
opaco sobre `(timestamp, id)` é estável e usa o índice.

**O proxy de mídia é requisito de segurança**, não conveniência: a URL de mídia que o WAHA
devolve aponta para dentro da rede Docker. Repassá-la ao integrador vazaria topologia e não
funcionaria de fora. `GET /v1/media/{messageId}` valida a API key, confere que a mensagem é
da aplicação e faz stream do conteúdo.

## Checklist

### Histórico
- [x] `GET /v1/messages` — filtros: `sessionId`, `chatId`, `direction`, `status`, `type`, `from`, `to`, `search`
- [x] Paginação por cursor: `?limit=&cursor=`, resposta `{ data, nextCursor, hasMore }`
- [x] Ordenação por `timestamp desc` usando o índice composto da tarefa 03
- [x] `limit` com teto (`MAX_PAGE_SIZE`, default 100)
- [x] `GET /v1/messages/{id}` — detalhe, incluindo `raw` só quando `?includeRaw=true`
- [x] Filtro por `applicationId` sempre aplicado; `sessionId` de outra aplicação devolve 404
- [x] Busca textual em `body` com índice apropriado (trigram ou full-text em PT-BR)

### Chats e contatos (ao vivo)
- [x] `GET /v1/sessions/{id}/chats` — paginado, do store do NOWEB
- [x] `GET /v1/sessions/{id}/chats/{chatId}/messages?limit=` — histórico do dispositivo
- [x] `GET /v1/sessions/{id}/contacts/check?phone=` — verifica se o número tem WhatsApp
- [x] Sessão sem store habilitado devolve 409 explicando como habilitar
- [x] Sessão não `WORKING` devolve 409
- [x] Cache curto no Redis (`CHATS_CACHE_TTL`, default 30s) para não martelar o WAHA

### Proxy de mídia
- [x] `GET /v1/media/{messageId}` — valida API key e ownership, faz stream da mídia
- [x] `Content-Type` e `Content-Disposition` corretos; `Content-Length` quando conhecido
- [x] Suporte a `Range` para áudio e vídeo
- [x] Stream real (sem carregar o arquivo inteiro em memória)
- [x] Mídia expirada/ausente devolve 404 com explicação
- [x] `Cache-Control: private, max-age=3600`
- [x] URL interna do WAHA **nunca** aparece em resposta da API pública — sanitizar em todos os serializers

### Exportação
- [x] `GET /v1/messages/export?format=csv` — respeita os mesmos filtros, streaming, teto de linhas configurável

### Documentação
- [x] Paginação por cursor explicada com exemplo de percurso completo
- [x] Diferença entre histórico do gateway e store do NOWEB documentada na tag Chats

### Testes
- [x] e2e: paginação percorre tudo sem repetir nem pular, com inserção concorrente
- [x] e2e: filtros combinados devolvem o conjunto certo
- [x] e2e: mídia de outra aplicação devolve 404
- [x] e2e: resposta não contém `WAHA_BASE_URL` em lugar nenhum
- [x] unit: cursor é opaco e resiste a valor adulterado

## Critérios de aceite

```bash
# paginação
curl -s "localhost:3001/v1/messages?sessionId=$SID&limit=5" -H "x-api-key: $KEY" | jq '{n: (.data|length), nextCursor, hasMore}'
C=$(curl -s "localhost:3001/v1/messages?sessionId=$SID&limit=5" -H "x-api-key: $KEY" | jq -r .nextCursor)
curl -s "localhost:3001/v1/messages?sessionId=$SID&limit=5&cursor=$C" -H "x-api-key: $KEY" | jq '.data[0].id'
# ids não se repetem entre as páginas

# filtros
curl -s "localhost:3001/v1/messages?sessionId=$SID&direction=INBOUND&from=2026-08-01" -H "x-api-key: $KEY" | jq '.data|length'

# chats do dispositivo
curl -s "localhost:3001/v1/sessions/$SID/chats?limit=10" -H "x-api-key: $KEY" | jq '.data[0]'

# número existe?
curl -s "localhost:3001/v1/sessions/$SID/contacts/check?phone=5511999999999" -H "x-api-key: $KEY" | jq .

# mídia por proxy, sem expor o WAHA
MID=$(curl -s "localhost:3001/v1/messages?sessionId=$SID&type=image&limit=1" -H "x-api-key: $KEY" | jq -r '.data[0].id')
curl -s "localhost:3001/v1/media/$MID" -H "x-api-key: $KEY" -o m.jpg -D - | head -5 && file m.jpg
curl -s -o /dev/null -w '%{http_code}\n' "localhost:3001/v1/media/$MID"        # 401 sem chave

# nenhuma URL interna vaza
curl -s "localhost:3001/v1/messages?sessionId=$SID" -H "x-api-key: $KEY" | grep -c 'waha:3000'   # 0

pnpm test:e2e -- history media
```

## Notas

### Um bug que só o teste pegaria

A decodificação do cursor usava `lastIndexOf('|')` para separar timestamp e id. Funciona até
um id conter o separador — aí o timestamp é truncado e a paginação quebra. O teste
"preserva ids que contêm o separador" falhou e expôs isso.

Corrigido para `indexOf`: o timestamp ISO **nunca** contém `|`, mas o id pode. Dividir pelo
primeiro é o correto.

### Paginação por cursor, não offset

`OFFSET` erra em tabela que cresce durante a navegação — e mensagens chegam o tempo todo:
uma mensagem nova empurra as demais e a página seguinte repete registros já vistos. O custo
também cresce com a profundidade.

O cursor codifica `(timestamp, id)`. O id **desempata**: sem ele, mensagens com timestamp
idêntico seriam puladas na virada de página. É opaco (base64url) para que clientes não o
interpretem e travem mudanças futuras.

Verificado percorrendo 41 registros em páginas de 10: **41 únicos, 0 repetidos**.

Buscamos `limite + 1` registros para saber se há próxima página. Um `COUNT` varreria a
tabela inteira a cada requisição.

### O proxy de mídia é segurança, não conveniência

A URL que o WAHA devolve aponta para dentro da rede Docker (`http://waha:3000/...`).
Repassá-la vazaria a topologia e não funcionaria de fora.

`toMessageResponse` **substitui** o campo por `/v1/media/{id}`. Verificado: zero ocorrências
de `waha:3000` em qualquer resposta, mesmo com o campo populado no banco.

### Duas fontes de dados, distinção documentada

- `GET /v1/messages` — o que passou por **este gateway**. Fonte para relatórios e auditoria.
- `GET /v1/sessions/{id}/chats` — lido do **aparelho** via store do NOWEB, inclui conversas
  anteriores à conexão.

A descrição de cada endpoint explica a diferença, porque é a primeira dúvida de quem integra.

### Filtrar por sessão alheia devolve 404, não lista vazia

Uma lista vazia pareceria "não há mensagens". O 404 é honesto e consistente com o resto da
API.

### Cache curto nas conversas

30 s no Redis. O painel recarrega com frequência e a lista tolera defasagem; sem cache, cada
abertura de tela martelaria o WAHA.

### CSV com BOM

Sem o BOM, o Excel abre UTF-8 como Latin-1 e corrompe toda acentuação. A exportação é
transmitida em fluxo, paginando internamente.

### Verificação executada

```
paginação (41 registros, páginas de 10)   5 páginas, 41 únicos, 0 repetidos
cursor adulterado                         422

filtros:
  todas                    41
  direction=INBOUND        19
  direction=OUTBOUND       22
  search                   1
  chatId                   6
  from no futuro           0
  data inválida            422 "from precisa ser uma data ISO 8601"

isolamento:
  aplicação B vê           0 registros
  B filtrando sessão do A  404 "Sessão não encontrada"

vazamento de URL interna   0 ocorrências de waha:3000
mediaUrl                   /v1/media/seed1

proxy de mídia:
  sem chave                401
  mensagem sem mídia       404 "Esta mensagem não possui mídia"
  mídia expirada           404 com explicação

CSV                        BOM + Content-Disposition, 42 linhas

pnpm test                  138 testes, 9 arquivos
```
