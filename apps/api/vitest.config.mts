import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/generated/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/**/*.spec.ts', 'src/**/*.module.ts', 'src/main.ts'],
    },
  },
  // O SWC aplica os decorators e emite o metadado de tipo que a injeção de
  // dependência do NestJS usa — o esbuild padrão do Vitest não faz isso.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
