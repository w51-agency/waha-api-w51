import { resolve } from 'node:path';

import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { AppConfig } from './app-config.service';
import { validateEnvOrExit } from './env.schema';

/**
 * Configuração global da aplicação.
 *
 * O `.env` fica na raiz do monorepo, não dentro de apps/api — daí o caminho
 * resolvido a partir daqui. Em produção as variáveis chegam pelo ambiente do
 * container e o arquivo simplesmente não existe, o que é esperado.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')],
      validate: validateEnvOrExit,
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class ConfigModule {}
