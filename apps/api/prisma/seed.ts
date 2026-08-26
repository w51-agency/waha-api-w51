import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

import { generateApiKey } from '../src/common/crypto/api-key.crypto';
import { PrismaClient } from '../src/generated/prisma/client';

config({ path: '../../.env' });

/**
 * Seed de desenvolvimento: cria uma aplicação demo com uma API key utilizável.
 *
 * É idempotente — rodar duas vezes não duplica nem falha. A chave só é emitida
 * se ainda não houver uma ativa, porque o segredo em claro existe apenas no
 * instante da criação: gerar outra a cada execução deixaria um rastro de chaves
 * órfãs que ninguém anotou.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const APP_SLUG = 'demo';
const KEY_NAME = 'seed';

async function main() {
  const application = await prisma.application.upsert({
    where: { slug: APP_SLUG },
    update: {},
    create: {
      name: 'Aplicação Demo',
      slug: APP_SLUG,
      description: 'Aplicação criada pelo seed para desenvolvimento e testes manuais.',
    },
  });

  console.log(`Aplicação: ${application.name} (${application.slug})  id=${application.id}`);

  const existing = await prisma.apiKey.findFirst({
    where: { applicationId: application.id, name: KEY_NAME, revokedAt: null },
  });

  if (existing) {
    console.log(`API key '${KEY_NAME}' já existe (prefixo ${existing.prefix}).`);
    console.log('O segredo não pode ser recuperado — para emitir outra:');
    console.log(`  pnpm db:seed:reset-key`);
    return;
  }

  const namespace = process.env.API_KEY_PREFIX ?? 'wgw_live';
  const generated = await generateApiKey(namespace);

  await prisma.apiKey.create({
    data: {
      applicationId: application.id,
      name: KEY_NAME,
      prefix: generated.prefix,
      hash: generated.hash,
      scopes: [],
    },
  });

  console.log('');
  console.log('  API key criada — anote agora, ela não será exibida de novo:');
  console.log('');
  console.log(`    ${generated.plaintext}`);
  console.log('');
  console.log('  Uso:');
  console.log(`    curl localhost:\${API_PORT}/v1/me -H "x-api-key: ${generated.plaintext}"`);
  console.log('');
}

main()
  .catch((error) => {
    console.error('Falha no seed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
