import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// O .env fica na raiz do monorepo, não neste diretório.
config({ path: '../../.env' });

/**
 * Configuração do Prisma CLI.
 *
 * A partir do Prisma 7 a URL de conexão saiu do `schema.prisma` e vive aqui.
 * Em tempo de execução o PrismaClient recebe um driver adapter
 * (`@prisma/adapter-pg`), configurado no PrismaService (tarefa 04).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
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
