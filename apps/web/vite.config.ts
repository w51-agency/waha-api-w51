import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * Configuração do painel.
 *
 * O proxy de desenvolvimento aponta para a API na porta do `.env` da raiz. Em
 * produção quem faz esse papel é o nginx (docker/web/nginx.conf.template), com
 * o destino resolvido por `envsubst` no arranque — por isso o front chama
 * sempre `/api` relativo e **nunca** uma URL absoluta.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');
  const apiPort = env.API_PORT || '3001';

  return {
    plugins: [react(), tailwindcss()],
    // O alias `@` precisa existir aqui além do tsconfig: o `tsc` lê `paths`,
    // mas o servidor de desenvolvimento do Vite não — sem isto o painel abre em
    // branco em `pnpm dev` com "Failed to resolve import '@/...'".
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // O shared é compilado em CommonJS para o NestJS. Servido cru ao browser,
        // o Vite não consegue extrair os exports nomeados ("does not provide an
        // export named ..."). Apontando para o fonte, o painel não depende do
        // `dist` nem de pré-bundle, e edita-se o shared com hot reload.
        '@gateway/shared': fileURLToPath(
          new URL('../../packages/shared/src/index.ts', import.meta.url),
        ),
      },
    },
    server: {
      port: Number(env.WEB_DEV_PORT || 5173),
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          rewrite: (caminho) => caminho.replace(/^\/api/, ''),
        },
      },
    },
    build: { outDir: 'dist', sourcemap: true },
  };
});
