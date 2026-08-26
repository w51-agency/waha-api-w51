import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'prisma/config';

/**
 * Carrega o `.env` da raiz do monorepo, sem depender do `dotenv`.
 *
 * O carregador de configuração do Prisma resolve os imports deste arquivo por
 * um caminho próprio que **não segue os symlinks do pnpm** — `require('dotenv')`
 * funciona no Node normal e falha aqui com "Cannot find module", inclusive com
 * o pacote presente na imagem. Como a necessidade é ler um arquivo de
 * `chave=valor`, oito linhas de `node:fs` eliminam a dependência e o problema.
 *
 * Em produção o arquivo não existe e as variáveis vêm do ambiente do container.
 */
function carregarEnv(caminho: string): void {
  if (!existsSync(caminho)) return;

  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    const conteudo = linha.trim();
    if (!conteudo || conteudo.startsWith('#')) continue;

    const separador = conteudo.indexOf('=');
    if (separador <= 0) continue;

    const chave = conteudo.slice(0, separador).trim();
    // Remove aspas e comentário à direita — o mesmo tratamento que o dotenv dá.
    const valor = conteudo
      .slice(separador + 1)
      .trim()
      .replace(/^["'](.*)["']$/, '$1');

    // Variáveis já definidas no ambiente têm precedência sobre o arquivo.
    process.env[chave] ??= valor;
  }
}

carregarEnv(resolve(process.cwd(), '../../.env'));
carregarEnv(resolve(process.cwd(), '.env'));

/**
 * Configuração do Prisma CLI.
 *
 * A partir do Prisma 7 a URL de conexão saiu do `schema.prisma` e vive aqui. Em
 * tempo de execução o PrismaClient recebe um driver adapter
 * (`@prisma/adapter-pg`), configurado no PrismaService.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // `process.env` em vez do helper `env()` do Prisma: o helper lança quando a
    // variável não existe, e `prisma generate` — que roda no build da imagem
    // Docker, sem banco à vista — não precisa de URL alguma.
    url: process.env.DATABASE_URL ?? '',
    // Opcional. O `migrate dev` cria um database temporário sozinho quando o
    // usuário tem permissão; em servidores onde não tem, aponte aqui um
    // database vazio dedicado.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
