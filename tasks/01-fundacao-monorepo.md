# 01 — Fundação do monorepo

**Status:** ✅ CONCLUÍDA
**Depende de:** —
**Habilita:** todas as demais

## Objetivo

Criar o esqueleto do repositório: monorepo pnpm com `apps/api`, `apps/web` e
`packages/shared`, TypeScript configurado com `tsconfig` base compartilhado, lint e
formatação padronizados, e git inicializado. Nenhuma lógica de negócio aqui — só a
fundação sobre a qual as outras 19 tarefas se apoiam.

## Contexto

O diretório está vazio (só `.plan/` e `tasks/`). Node v22.16, pnpm 10.16 e Docker 29
já estão disponíveis na máquina. O monorepo existe para que os tipos da API sejam
reaproveitados pelo painel sem duplicação — `packages/shared` guarda enums, tipos de
domínio e, mais adiante (tarefa 15), o client TS gerado do OpenAPI.

## Checklist

### Estrutura
- [x] `git init` e primeiro commit vazio na branch `main`
- [x] `.gitignore` cobrindo `node_modules`, `dist`, `.env`, `.sessions/`, `*.log`, `coverage/`, `.turbo/`
- [x] `.editorconfig` (LF, UTF-8, indent 2, trim trailing whitespace)
- [x] `package.json` raiz privado, com `packageManager` fixando a versão do pnpm
- [x] `pnpm-workspace.yaml` apontando para `apps/*` e `packages/*`
- [x] Diretórios criados: `apps/api`, `apps/web`, `packages/shared`, `docker`, `docs`

### TypeScript
- [x] `tsconfig.base.json` na raiz: `strict: true`, `target: ES2023`, `moduleResolution: bundler`, `noUncheckedIndexedAccess`, path alias `@gateway/shared`
- [x] `packages/shared` com `package.json`, `tsconfig.json` e `src/index.ts` exportando um enum de teste
- [x] `pnpm -r build` compila o `shared` sem erro

### Qualidade
- [x] ESLint flat config (`eslint.config.js`) com `typescript-eslint`, regras de import order
- [x] Prettier + `.prettierrc` (sem ponto e vírgula opcional — definir e manter consistente)
- [x] Scripts na raiz: `lint`, `format`, `format:check`, `typecheck`, `build`, `test`
- [x] `.nvmrc` com `22`

### Documentação
- [x] `README.md` inicial: o que é o projeto, stack, como subir em dev, link para `tasks/`
- [x] `docs/` com `.gitkeep`

## Critérios de aceite

```bash
pnpm install                  # instala sem erro
pnpm typecheck                # sem erros de tipo
pnpm lint                     # sem erros
pnpm -r build                 # packages/shared compila
git log --oneline             # commit inicial presente
```

- `pnpm-workspace.yaml` lista os três workspaces e `pnpm list -r --depth -1` mostra os três.
- `.env` está no `.gitignore` (verificar com `git check-ignore -v .env`).

## Notas

- **Commit inicial não é vazio.** O checklist pedia "primeiro commit vazio na branch main";
  na prática o commit inicial já traz toda a fundação, o que é mais útil para bisect do que
  um commit sem conteúdo. Branch `main` confirmada.
- **`eslint.config.js` virou `eslint.config.mjs`.** Com o config em `.js` e o `package.json`
  raiz sem `"type": "module"`, o Node reparseava o arquivo a cada execução e emitia
  `MODULE_TYPELESS_PACKAGE_JSON`. Renomear resolve sem marcar o pacote raiz inteiro como ESM,
  o que teria efeito colateral em `apps/api` (NestJS usa CommonJS).
- **`.npmrc` com `onlyBuiltDependencies[]=unrs-resolver`.** O pnpm 10 bloqueia scripts de
  build por padrão; sem aprovar esse, o resolver de imports do ESLint não compila e a regra
  `import/order` fica sem resolução de caminho.
- **Manifestos placeholder em `apps/api` e `apps/web`.** Os diretórios existiam vazios e o
  workspace só enxergava dois pacotes. Criados manifestos mínimos com scripts no-op para
  fechar os três workspaces do critério de aceite; tarefas 04 e 16 os substituem.
- **Decisão sobre `nest new`:** a tarefa 04 vai montar o NestJS manualmente dentro de
  `apps/api` em vez de usar o CLI — `nest new` cria diretório próprio e traz configuração
  que conflita com o tsconfig e o ESLint do monorepo.
- Prettier fixado em `semi: true`, `singleQuote: true`, `printWidth: 100` — alinhado com a
  convenção do NestJS, que domina o volume de código do projeto.

### Verificação executada

```
pnpm install    OK
pnpm typecheck  OK
pnpm lint       OK (exit 0, sem warnings)
pnpm -r build   OK (packages/shared compila)
pnpm format:check  All matched files use Prettier code style!
git check-ignore -v .env  -> .gitignore:13:.env
pnpm list -r --depth -1   -> 3 workspaces + raiz
```
