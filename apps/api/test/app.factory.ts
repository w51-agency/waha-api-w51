import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Sobe a aplicação real para os testes e2e.
 *
 * `rawBody: true` e o `ValidationPipe` são replicados do `main.ts` — sem eles o
 * teste exercitaria uma aplicação diferente da que roda em produção, e o HMAC
 * dos webhooks (que depende do corpo bruto) passaria a falhar só fora do teste.
 */
export async function criarApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
    logger: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();

  return app;
}

/**
 * Limpa as tabelas entre testes.
 *
 * `TRUNCATE ... CASCADE` em vez de deleteMany: é uma ordem só, respeita as
 * chaves estrangeiras e reinicia as sequências.
 */
export async function limparBanco(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_logs, inbound_events, webhook_deliveries, webhook_endpoints,
      messages, sessions, api_keys, applications
    RESTART IDENTITY CASCADE
  `);

  // Também limpa o Redis: cache de API key, contadores de rate limit e refresh
  // tokens sobreviveriam entre testes e produziriam falhas que dependem da
  // ordem de execução.
  await app.get(RedisService).client.flushdb();
}

export async function tokenAdmin(app: INestApplication): Promise<string> {
  const { default: request } = await import('supertest');

  const resposta = await request(app.getHttpServer())
    .post('/admin/auth/login')
    .send({ username: 'admin', password: 'senha-de-teste-bem-longa' })
    .expect(200);

  return (resposta.body as { accessToken: string }).accessToken;
}

/** Cria uma aplicação com uma chave e devolve os dois. */
export async function criarAplicacaoComChave(
  app: INestApplication,
  token: string,
  nome: string,
): Promise<{ applicationId: string; apiKey: string; slug: string }> {
  const { default: request } = await import('supertest');

  const aplicacao = await request(app.getHttpServer())
    .post('/admin/applications')
    .set('authorization', `Bearer ${token}`)
    .send({ name: nome })
    .expect(201);

  const corpoApp = aplicacao.body as { id: string; slug: string };

  const chave = await request(app.getHttpServer())
    .post(`/admin/applications/${corpoApp.id}/api-keys`)
    .set('authorization', `Bearer ${token}`)
    .send({ name: 'teste' })
    .expect(201);

  return {
    applicationId: corpoApp.id,
    slug: corpoApp.slug,
    apiKey: (chave.body as { secret: string }).secret,
  };
}
