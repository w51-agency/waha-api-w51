import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { AppConfig } from '../config';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Cliente Prisma como serviço injetável.
 *
 * O Prisma 7 exige um driver adapter em tempo de execução (a URL saiu do
 * `schema.prisma` e vive em `prisma.config.ts`, que só o CLI enxerga). O
 * `PrismaPg` faz esse papel, usando o pool do `pg`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    const adapter = new PrismaPg({ connectionString: config.get('DATABASE_URL') });

    super({
      adapter,
      // Query em nível debug é ruidoso e pode conter dados de mensagem —
      // só é ligado quando explicitamente pedido.
      log:
        config.get('LOG_LEVEL') === 'debug' || config.get('LOG_LEVEL') === 'trace'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conectado ao Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Verificação usada pelo readiness. */
  async healthCheck(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
