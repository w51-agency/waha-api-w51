import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    // O ambiente precisa estar montado ANTES de qualquer import dos testes: o
    // ConfigModule do Nest lê e valida as variáveis no momento em que o módulo
    // é carregado. Como `setupFiles`, o vitest garante essa ordem — deixar isso
    // a cargo da ordem dos imports é frágil, e a regra `import/order` do ESLint
    // já reordenou uma vez, fazendo os testes usarem o .env real.
    setupFiles: ['./test/setup.ts'],
    // Um arquivo por vez: os testes truncam tabelas compartilhadas, e paralelizar
    // faria um limpar o banco enquanto outro depende dele.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
