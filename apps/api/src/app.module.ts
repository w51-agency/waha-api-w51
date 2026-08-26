import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingModule } from './common/logging/logging.module';
import { AppConfig, ConfigModule } from './config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    PrismaModule,
    RedisModule,

    // Limite base por IP. A tarefa 05 acrescenta o limite por API key, que é o
    // que realmente importa: chavear só por IP puniria todos os clientes atrás
    // de um mesmo NAT por causa de um só.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [AppConfig, RedisService],
      useFactory: (config: AppConfig, redis: RedisService) => ({
        throttlers: [
          {
            ttl: config.get('RATE_LIMIT_TTL') * 1000,
            limit: config.get('RATE_LIMIT_LIMIT'),
          },
        ],
        // Contador no Redis, não em memória: com mais de uma instância da API,
        // um contador por processo multiplicaria o limite real pelo número de
        // réplicas — o rate limit viraria decorativo.
        storage: new ThrottlerStorageRedisService(redis.client),
      }),
    }),

    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
