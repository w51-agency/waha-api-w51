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
