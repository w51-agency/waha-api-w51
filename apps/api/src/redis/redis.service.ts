import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import { AppConfig } from '../config';

/**
 * Conexão Redis compartilhada — cache de API key, rate limit e refresh tokens.
 *
 * `maxRetriesPerRequest: null` é exigência do BullMQ (tarefa 13): com um limite
 * finito, comandos bloqueantes de fila falham durante uma reconexão. Como a
 * mesma instância serve cache e fila, o valor vale para as duas.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: AppConfig) {
    this.client = new Redis(config.get('REDIS_URL'), {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
      lazyConnect: false,
    });

    this.client.on('error', (error) => {
      // Sem `once`: o ioredis reemite a cada tentativa. Nível warn porque ele
      // reconecta sozinho — só vira problema se o readiness reprovar.
      this.logger.warn(`Redis: ${error.message}`);
    });

    this.client.on('ready', () => this.logger.log('Conectado ao Redis'));
  }

  async healthCheck(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
