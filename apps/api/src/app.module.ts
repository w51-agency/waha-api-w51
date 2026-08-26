import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ApiThrottlerGuard } from './common/guards/api-throttler.guard';
import { LoggingModule } from './common/logging/logging.module';
import { AppConfig, ConfigModule } from './config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { AccountModule } from './modules/account/account.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuditModule } from './modules/audit/audit.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { WahaModule } from './modules/waha/waha.module';
import { ApiKeyGuard } from './modules/api-keys/api-key.guard';
import { ApiKeyModule } from './modules/api-keys/api-key.module';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    WahaModule,

    // O contador é chaveado pela API key (ver ApiThrottlerGuard); requisições
    // ainda não autenticadas caem no IP.
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
    ApiKeyModule,
    AccountModule,
    AdminAuthModule,
    AuditModule,
    ApplicationsModule,
    SessionsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },

    // A ORDEM IMPORTA. Guards globais rodam na ordem de registro, e o rate
    // limit precisa saber qual chave está falando para contar por chave em vez
    // de por IP. Invertê-los faria o ApiThrottlerGuard cair sempre no IP,
    // silenciosamente.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: ApiThrottlerGuard },
  ],
})
export class AppModule {}
