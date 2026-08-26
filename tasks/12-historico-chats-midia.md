# 12 — Histórico, chats e proxy de mídia

**Status:** ⬜ pendente
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
- [ ] `GET /v1/messages` — filtros: `sessionId`, `chatId`, `direction`, `status`, `type`, `from`, `to`, `search`
- [ ] Paginação por cursor: `?limit=&cursor=`, resposta `{ data, nextCursor, hasMore }`
- [ ] Ordenação por `timestamp desc` usando o índice composto da tarefa 03
- [ ] `limit` com teto (`MAX_PAGE_SIZE`, default 100)
- [ ] `GET /v1/messages/{id}` — detalhe, incluindo `raw` só quando `?includeRaw=true`
- [ ] Filtro por `applicationId` sempre aplicado; `sessionId` de outra aplicação devolve 404
- [ ] Busca textual em `body` com índice apropriado (trigram ou full-text em PT-BR)

### Chats e contatos (ao vivo)
- [ ] `GET /v1/sessions/{id}/chats` — paginado, do store do NOWEB
- [ ] `GET /v1/sessions/{id}/chats/{chatId}/messages?limit=` — histórico do dispositivo
- [ ] `GET /v1/sessions/{id}/contacts/check?phone=` — verifica se o número tem WhatsApp
- [ ] Sessão sem store habilitado devolve 409 explicando como habilitar
- [ ] Sessão não `WORKING` devolve 409
- [ ] Cache curto no Redis (`CHATS_CACHE_TTL`, default 30s) para não martelar o WAHA

### Proxy de mídia
- [ ] `GET /v1/media/{messageId}` — valida API key e ownership, faz stream da mídia
- [ ] `Content-Type` e `Content-Disposition` corretos; `Content-Length` quando conhecido
- [ ] Suporte a `Range` para áudio e vídeo
- [ ] Stream real (sem carregar o arquivo inteiro em memória)
- [ ] Mídia expirada/ausente devolve 404 com explicação
- [ ] `Cache-Control: private, max-age=3600`
- [ ] URL interna do WAHA **nunca** aparece em resposta da API pública — sanitizar em todos os serializers

### Exportação
- [ ] `GET /v1/messages/export?format=csv` — respeita os mesmos filtros, streaming, teto de linhas configurável

### Documentação
- [ ] Paginação por cursor explicada com exemplo de percurso completo
- [ ] Diferença entre histórico do gateway e store do NOWEB documentada na tag Chats

### Testes
- [ ] e2e: paginação percorre tudo sem repetir nem pular, com inserção concorrente
- [ ] e2e: filtros combinados devolvem o conjunto certo
- [ ] e2e: mídia de outra aplicação devolve 404
- [ ] e2e: resposta não contém `WAHA_BASE_URL` em lugar nenhum
- [ ] unit: cursor é opaco e resiste a valor adulterado

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

_(preencher durante a execução)_
