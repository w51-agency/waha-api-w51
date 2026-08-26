import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AppConfig } from './config';
import { setupSwagger } from './swagger';

import type { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // O corpo bruto é indispensável para a tarefa 10: o HMAC dos webhooks do
    // WAHA é calculado sobre os bytes exatos que chegaram. Se o body for
    // parseado e reserializado — mudando ordem de chaves ou espaçamento — a
    // assinatura não bate. Habilitar aqui evita ter que refazer o bootstrap
    // depois.
    rawBody: true,
    bufferLogs: true,
  });

  const config = app.get(AppConfig);

  app.useLogger(app.get(Logger));
  app.flushLogs();

  app.use(helmet({ contentSecurityPolicy: false }));

  // Limite de corpo: mídia em base64 passa por aqui (tarefa 11), então o
  // default de 100kb do express seria pequeno demais. Vem do .env para poder
  // ser apertado em produção sem recompilar.
  const bodyLimit = config.get('BODY_LIMIT');
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  const origins = config.corsOrigins;
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    exposedHeaders: ['x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'retry-after'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // `whitelist` remove campos não declarados; `forbidNonWhitelisted` os
      // rejeita explicitamente. Sem o segundo, um cliente que digita
      // "sessonId" recebe 200 e um comportamento inesperado, em vez de um erro
      // dizendo onde está o engano.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,
    }),
  );

  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  setupSwagger(app, config);

  await app.listen(config.port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`API ouvindo na porta ${config.port} (${config.nodeEnv})`);
  if (config.get('SWAGGER_ENABLED')) {
    logger.log(`Documentação em http://localhost:${config.port}/docs`);
  }
}

bootstrap().catch((error: unknown) => {
  // A validação da configuração lança aqui. Sem este catch, o Node imprime um
  // stack trace de promise rejeitada e a mensagem útil se perde no meio.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
});
