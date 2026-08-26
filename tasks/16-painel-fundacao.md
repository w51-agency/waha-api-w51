# 16 — Painel: fundação

**Status:** ✅ CONCLUÍDA
**Depende de:** 06, 15
**Habilita:** 17, 18, 19

## Objetivo

Montar o esqueleto do painel: Vite + React + Tailwind + shadcn/ui, roteamento com rotas
protegidas, camada de dados com TanStack Query, tela de login e o layout que as próximas
três tarefas preenchem.

## Contexto

Decisão de configuração que precisa estar certa desde o começo: **a URL da API não pode ser
congelada no build do Vite**. Variáveis `VITE_*` são substituídas em tempo de compilação;
se a URL entrar aí, trocar `API_PORT` no `.env` exigiria rebuild da imagem — exatamente o
oposto do que foi pedido.

A solução: o front sempre chama **`/api` relativo**, e o nginx que serve o painel faz proxy
para `${API_HOST}:${API_PORT}`, com o `nginx.conf` gerado por `envsubst` no entrypoint do
container. Trocar a porta é reiniciar o container, sem rebuild.

Sobre autenticação: access token de vida curta em memória (não em `localStorage`, que é
alcançável por XSS), refresh token persistido, e um interceptor que renova
automaticamente no 401 — com **fila de requisições durante a renovação**, senão dez chamadas
simultâneas disparam dez refreshes e a rotação da tarefa 06 invalida a família inteira,
derrubando o usuário.

## Checklist

### Projeto
- [x] Vite + React 19 + TypeScript em `apps/web`
- [x] Tailwind v4 configurado com tokens de tema
- [x] shadcn/ui inicializado com os componentes base (button, input, table, dialog, card, badge, toast, dropdown, tabs, skeleton)
- [x] Tema claro e escuro com persistência da preferência
- [x] Fonte e paleta definidas; identidade visual sóbria e consistente

### Configuração em runtime
- [x] Client HTTP usando **`/api` relativo** — nenhuma URL absoluta no código
- [x] `docker/web/nginx.conf.template` com `${API_HOST}` e `${API_PORT}`
- [x] Entrypoint rodando `envsubst` antes de subir o nginx
- [x] SPA fallback (`try_files ... /index.html`) para as rotas do router
- [x] Proxy de SSE com `proxy_buffering off` e timeout longo — sem isso o stream da tarefa 14 trava
- [x] Verificar: `grep -r 'localhost:3001' apps/web/src` não retorna nada

### Dados
- [x] TanStack Query com defaults sensatos (`staleTime`, retry, refetch on focus)
- [x] Client tipado gerado do `docs/openapi.json` (tarefa 15), com script `pnpm api:types`
- [x] Tratamento central de erro lendo o `ProblemDetails` e mostrando o `detail` em PT-BR
- [x] Toasts padronizados para sucesso e erro

### Autenticação
- [x] Tela de login sóbria, com validação e mensagem de erro clara
- [x] Access token em memória; refresh persistido
- [x] Interceptor de 401 com refresh automático **e fila de requisições concorrentes**
- [x] Refresh falhado → logout e redirect para o login preservando a rota pretendida
- [x] Rotas protegidas com guard no router
- [x] Botão de sair chamando `/admin/auth/logout`

### Layout
- [x] Sidebar com navegação: Visão geral, Sessões, Mensagens, Aplicações, Webhooks, Auditoria
- [x] Topbar com indicador de saúde do sistema (consumindo `/health/ready`), tema e sair
- [x] Responsivo — utilizável em tablet e celular
- [x] Estados de carregamento com skeleton, não spinner de tela cheia
- [x] Estado vazio desenhado (o primeiro acesso não pode parecer defeito)
- [x] Error boundary por rota

### Hook de SSE
- [x] `useEventStream()` conectando em `/api/admin/events`, com reconexão exponencial
- [x] Invalidação seletiva de queries do TanStack conforme o evento recebido
- [x] Indicador visual de conexão ao vivo

## Critérios de aceite

```bash
cd apps/web && pnpm dev
xdg-open http://localhost:5173          # login carrega

# login e navegação funcionam; recarregar em rota interna mantém a sessão
# senha errada mostra mensagem em PT-BR
# token expirado renova sozinho, sem o usuário perceber

# nenhuma URL de API congelada
grep -rn 'localhost:3001\|127.0.0.1:3001' apps/web/src ; echo "saída vazia esperada"

# build e container respeitando a porta do .env
pnpm build
docker compose build web
API_PORT=4001 WEB_PORT=9090 docker compose up -d
curl -s -o /dev/null -w '%{http_code}\n' localhost:9090/                    # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:9090/api/health          # 200, proxy ok

pnpm typecheck && pnpm lint
```

## Notas

### A fila de renovação não é detalhe — é o que impede perder a sessão

A API rotaciona o refresh token e **derruba a família inteira** se um for usado duas vezes
(tarefa 06). Se dez requisições receberem 401 juntas e cada uma disparar seu próprio
refresh, a segunda é interpretada como reuso e o usuário é expulso.

Isso aconteceria exatamente quando o painel carrega vários dados de uma vez — ou seja,
sempre. A promessa de renovação é compartilhada: a primeira renova, as demais aguardam.

### Access token em memória, refresh em localStorage

Token em `localStorage` é legível por qualquer script que rode na página. Em memória, ele
desaparece com a aba. O custo — reautenticar ao abrir aba nova — é resolvido em silêncio
pelo refresh token, que tem menos poder e vida controlada no servidor.

### `BODY_LIMIT=25mb` quebraria o nginx

O Express aceita `25mb`; o nginx exige `25m` e **se recusa a subir** com o sufixo completo.
Como a variável é compartilhada, a conversão acontece no entrypoint — em vez de obrigar quem
configura a lembrar de dois formatos. Testado com `25mb`, `25m`, `512kb`, `1gb`, `100k`.

### SSE precisa de bloco próprio no nginx

`proxy_buffering` é a armadilha clássica: com ele ligado (o padrão), o nginx segura os
eventos esperando encher o buffer, e o painel recebe tudo em lote — ou nada, até a conexão
cair. O bloco `/api/admin/events` desliga buffer e cache, e usa timeout de 24h, bem acima do
heartbeat de 25s da aplicação.

### Nenhuma URL de API no bundle — verificado

`grep` por `localhost:` no bundle compilado não retorna nada. O front chama `/api` relativo;
o destino é resolvido pelo proxy do Vite em desenvolvimento e pelo `envsubst` do nginx em
produção.

Verificado na prática: subindo a API em `API_PORT=4001`, o painel a alcançou **sem
reconstruir nada**.

### Indicador de conexão ao vivo

Um stream caído deixaria o painel silenciosamente desatualizado, e o operador confiaria em
números velhos. O indicador na barra superior mostra "ao vivo" ou "reconectando".

### Uma conexão SSE para o painel inteiro

Compartilhada entre as telas, com invalidação seletiva do cache por tipo de evento. Abrir
uma conexão por componente multiplicaria conexões que o servidor mantém abertas; invalidar
tudo a cada evento faria o painel refazer todas as consultas numa conversa movimentada.

### Roteamento por hash

Sem servidor de rotas: funciona em qualquer hospedagem e sobrevive a recarregar em rota
interna sem depender de configuração de fallback. O nginx tem `try_files` mesmo assim, como
rede de segurança.

### Verificação executada

```
pnpm build (web)              1864 módulos, 477 kB (145 kB gzip)
painel em dev                 200
proxy /api/health             ok
login pelo proxy              token emitido
SSE pelo proxy                conexão estabelecida
API_PORT=4001                 painel acompanhou sem rebuild

grep localhost: no bundle     nenhuma ocorrência
conversão de BODY_LIMIT       25mb->25m, 512kb->512k, 1gb->1g, 100k->100k

pnpm typecheck / lint / format:check / build / smoke   todos verdes
```

### O que fica para as próximas

As telas concretas são as tarefas 17 (sessões e QR), 18 (mensagens e métricas) e 19
(aplicações, chaves, webhooks e auditoria). O roteador já as prevê e exibe um estado
provisório identificando a tarefa responsável.
