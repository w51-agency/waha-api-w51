# 01 — Fundação do monorepo

**Status:** ⬜ pendente
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
- [ ] `git init` e primeiro commit vazio na branch `main`
- [ ] `.gitignore` cobrindo `node_modules`, `dist`, `.env`, `.sessions/`, `*.log`, `coverage/`, `.turbo/`
- [ ] `.editorconfig` (LF, UTF-8, indent 2, trim trailing whitespace)
- [ ] `package.json` raiz privado, com `packageManager` fixando a versão do pnpm
- [ ] `pnpm-workspace.yaml` apontando para `apps/*` e `packages/*`
- [ ] Diretórios criados: `apps/api`, `apps/web`, `packages/shared`, `docker`, `docs`

### TypeScript
- [ ] `tsconfig.base.json` na raiz: `strict: true`, `target: ES2023`, `moduleResolution: bundler`, `noUncheckedIndexedAccess`, path alias `@gateway/shared`
- [ ] `packages/shared` com `package.json`, `tsconfig.json` e `src/index.ts` exportando um enum de teste
- [ ] `pnpm -r build` compila o `shared` sem erro

### Qualidade
- [ ] ESLint flat config (`eslint.config.js`) com `typescript-eslint`, regras de import order
- [ ] Prettier + `.prettierrc` (sem ponto e vírgula opcional — definir e manter consistente)
- [ ] Scripts na raiz: `lint`, `format`, `format:check`, `typecheck`, `build`, `test`
- [ ] `.nvmrc` com `22`

### Documentação
- [ ] `README.md` inicial: o que é o projeto, stack, como subir em dev, link para `tasks/`
- [ ] `docs/` com `.gitkeep`

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

_(preencher durante a execução)_
