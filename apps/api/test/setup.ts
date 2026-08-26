import { config } from 'dotenv';

config({ path: '../../.env' });

/**
 * Ambiente dos testes e2e.
 *
 * Carregado como `setupFiles` no `vitest.e2e.mts`, **não** por import: o
 * `ConfigModule` do Nest valida e cacheia as variáveis no instante em que é
 * carregado, então qualquer import de `src/` que aconteça antes daqui
 * congelaria o `.env` real. Como setupFile, o vitest garante a ordem.
 *
 * Usa um **database separado** (`gateway_test`), criado e migrado pelo
 * `test/e2e-setup.sh`. Rodar e2e contra o banco de desenvolvimento apagaria
 * dados reais entre execuções — e a limpeza entre testes exige truncar tabelas.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = (process.env.DATABASE_URL ?? '').replace(
  /\/gateway(\?|$)/,
  '/gateway_test$1',
);
process.env.SWAGGER_ENABLED = 'false';
process.env.LOG_LEVEL = 'silent';

// Limites altos: o teste de rate limit define os seus próprios.
process.env.RATE_LIMIT_LIMIT = '10000';

/**
 * Redis em database separado (índice 15).
 *
 * O contador de rate limit vive lá, e o login administrativo tem um limite
 * agressivo de 5 tentativas por 5 minutos (tarefa 06). Como cada teste faz
 * login no `beforeEach`, sem isolar o contador a suíte se autobloqueia a partir
 * do sexto teste — e a falha aparece como 429 em um teste que não tem nada a
 * ver com rate limit.
 */
process.env.REDIS_URL = `${(process.env.REDIS_URL ?? 'redis://localhost:6379').replace(/\/\d+$/, '')}/15`;

process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'senha-de-teste-bem-longa';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'y'.repeat(40);
process.env.WAHA_WEBHOOK_HMAC_KEY = 'z'.repeat(40);

// O WAHA é interceptado pelo MSW; a URL só precisa ser válida e inalcançável.
process.env.WAHA_BASE_URL = 'http://waha-mock.invalid:3000';
process.env.WAHA_API_KEY = 'chave-do-waha-de-teste';
process.env.GATEWAY_INTERNAL_URL = 'http://localhost:3001';
process.env.ALLOW_INSECURE_WEBHOOKS = 'true';
