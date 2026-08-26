import { z } from 'zod';

/**
 * Contrato das variáveis de ambiente.
 *
 * A validação roda na subida e **derruba o processo** se algo estiver faltando ou
 * malformado. Isso é deliberado: uma API que sobe com `JWT_SECRET` vazio e só
 * falha no primeiro login é muito pior de diagnosticar do que uma que se recusa
 * a subir dizendo exatamente qual variável está errada.
 */

const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);

const bool = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(fallback)
    .transform((v) =>
      typeof v === 'boolean' ? v : ['true', '1', 'yes'].includes(v.toLowerCase()),
    );

/** Segredos precisam de entropia suficiente para não serem quebrados por força bruta. */
const secret = (name: string) =>
  z
    .string({ error: `${name} é obrigatória` })
    .min(32, `${name} precisa ter ao menos 32 caracteres (use ./scripts/gen-secrets.sh)`);

export const envSchema = z.object({
  // --- ambiente ---
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('America/Sao_Paulo'),

  // --- rede ---
  API_PORT: port(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('json'),

  // --- banco e cache ---
  DATABASE_URL: z.string({ error: 'DATABASE_URL é obrigatória' }).min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // --- WAHA ---
  WAHA_BASE_URL: z.url({ error: 'WAHA_BASE_URL precisa ser uma URL válida' }),
  WAHA_API_KEY: z.string({ error: 'WAHA_API_KEY é obrigatória' }).min(1),
  WAHA_WEBHOOK_HMAC_KEY: secret('WAHA_WEBHOOK_HMAC_KEY'),
  GATEWAY_INTERNAL_URL: z.url({
    error: 'GATEWAY_INTERNAL_URL precisa ser a URL pela qual o WAHA alcança este gateway',
  }),
  WHATSAPP_DEFAULT_ENGINE: z.enum(['NOWEB', 'WEBJS', 'GOWS']).default('NOWEB'),
  WAHA_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  // --- painel (usuário único) ---
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z
    .string({ error: 'ADMIN_PASSWORD é obrigatória' })
    .min(8, 'ADMIN_PASSWORD precisa ter ao menos 8 caracteres'),
  JWT_SECRET: secret('JWT_SECRET'),
  JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  // --- API pública ---
  API_KEY_PREFIX: z.string().min(1).default('wgw_live'),
  CORS_ORIGINS: z.string().default(''),
  BODY_LIMIT: z.string().default('25mb'),
  RATE_LIMIT_TTL: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_LIMIT: z.coerce.number().int().positive().default(120),
  SWAGGER_ENABLED: bool(true),

  // --- limites e retenção ---
  MAX_SESSIONS_PER_APP: z.coerce.number().int().min(0).default(0),
  MAX_MEDIA_SIZE_MB: z.coerce.number().int().positive().default(16),
  MAX_PAGE_SIZE: z.coerce.number().int().positive().default(100),
  SESSION_SYNC_INTERVAL: z.coerce.number().int().positive().default(60),
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(6),
  WEBHOOK_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(20),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  ALLOW_INSECURE_WEBHOOKS: bool(false),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida o ambiente. Em caso de erro, monta uma mensagem legível em PT-BR
 * listando **todas** as variáveis problemáticas de uma vez — corrigir uma por
 * execução seria exasperante.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const problemas = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      [
        '',
        'Configuração inválida — a API não pode subir.',
        '',
        problemas,
        '',
        'Verifique o arquivo .env na raiz do repositório.',
        'Para gerar os segredos: ./scripts/gen-secrets.sh',
        '',
      ].join('\n'),
    );
  }

  return result.data;
}

/**
 * Igual a `validateEnv`, mas imprime a mensagem e encerra o processo em vez de
 * lançar.
 *
 * O `ConfigModule.forRoot` roda no momento em que o módulo é importado — antes
 * do `bootstrap()` e do seu `catch`. Uma exceção ali sobe como erro de
 * carregamento de módulo e o Node imprime vinte linhas de stack trace com a
 * mensagem útil no meio. Como um ambiente inválido não tem recuperação
 * possível, encerrar aqui com uma mensagem limpa é o comportamento certo.
 *
 * `validateEnv` continua exportada e pura, para os testes.
 */
export function validateEnvOrExit(raw: Record<string, unknown>): Env {
  try {
    return validateEnv(raw);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
