import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from './env.schema';

/**
 * Acesso tipado à configuração.
 *
 * Existe para que `process.env` não apareça espalhado pelo código: com ele, um
 * nome de variável digitado errado é erro de compilação, não um `undefined`
 * silencioso descoberto em produção.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true }) as Env[K];
  }

  // --- atalhos usados com frequência ---

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  get port(): number {
    return this.get('API_PORT');
  }

  /** Origens de CORS já divididas. String vazia significa "nenhuma origem liberada". */
  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get maxMediaSizeBytes(): number {
    return this.get('MAX_MEDIA_SIZE_MB') * 1024 * 1024;
  }
}
