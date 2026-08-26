# 16 — Painel: fundação

**Status:** ⬜ pendente
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
- [ ] Vite + React 19 + TypeScript em `apps/web`
- [ ] Tailwind v4 configurado com tokens de tema
- [ ] shadcn/ui inicializado com os componentes base (button, input, table, dialog, card, badge, toast, dropdown, tabs, skeleton)
- [ ] Tema claro e escuro com persistência da preferência
- [ ] Fonte e paleta definidas; identidade visual sóbria e consistente

### Configuração em runtime
- [ ] Client HTTP usando **`/api` relativo** — nenhuma URL absoluta no código
- [ ] `docker/web/nginx.conf.template` com `${API_HOST}` e `${API_PORT}`
- [ ] Entrypoint rodando `envsubst` antes de subir o nginx
- [ ] SPA fallback (`try_files ... /index.html`) para as rotas do router
- [ ] Proxy de SSE com `proxy_buffering off` e timeout longo — sem isso o stream da tarefa 14 trava
- [ ] Verificar: `grep -r 'localhost:3001' apps/web/src` não retorna nada

### Dados
- [ ] TanStack Query com defaults sensatos (`staleTime`, retry, refetch on focus)
- [ ] Client tipado gerado do `docs/openapi.json` (tarefa 15), com script `pnpm api:types`
- [ ] Tratamento central de erro lendo o `ProblemDetails` e mostrando o `detail` em PT-BR
- [ ] Toasts padronizados para sucesso e erro

### Autenticação
- [ ] Tela de login sóbria, com validação e mensagem de erro clara
- [ ] Access token em memória; refresh persistido
- [ ] Interceptor de 401 com refresh automático **e fila de requisições concorrentes**
- [ ] Refresh falhado → logout e redirect para o login preservando a rota pretendida
- [ ] Rotas protegidas com guard no router
- [ ] Botão de sair chamando `/admin/auth/logout`

### Layout
- [ ] Sidebar com navegação: Visão geral, Sessões, Mensagens, Aplicações, Webhooks, Auditoria
- [ ] Topbar com indicador de saúde do sistema (consumindo `/health/ready`), tema e sair
- [ ] Responsivo — utilizável em tablet e celular
- [ ] Estados de carregamento com skeleton, não spinner de tela cheia
- [ ] Estado vazio desenhado (o primeiro acesso não pode parecer defeito)
- [ ] Error boundary por rota

### Hook de SSE
- [ ] `useEventStream()` conectando em `/api/admin/events`, com reconexão exponencial
- [ ] Invalidação seletiva de queries do TanStack conforme o evento recebido
- [ ] Indicador visual de conexão ao vivo

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

_(preencher durante a execução)_
