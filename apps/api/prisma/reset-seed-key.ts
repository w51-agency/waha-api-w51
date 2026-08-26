import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

import { PrismaClient } from '../src/generated/prisma/client';

config({ path: '../../.env' });

/**
 * Revoga a API key do seed e emite uma nova.
 *
 * Existe porque o segredo em claro só aparece uma vez: se você perdeu o valor
 * impresso pelo seed, não há como recuperá-lo — o caminho é revogar e reemitir.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const app = await prisma.application.findUnique({ where: { slug: 'demo' } });
  if (!app) {
    console.error("Aplicação 'demo' não existe. Rode `pnpm db:seed` primeiro.");
    process.exitCode = 1;
    return;
  }

  const revoked = await prisma.apiKey.updateMany({
    where: { applicationId: app.id, name: 'seed', revokedAt: null },
    data: { revokedAt: new Date() },
  });
  console.log(`${revoked.count} chave(s) anterior(es) revogada(s).`);

  const { generateApiKey } = await import('../src/common/crypto/api-key.crypto');
  const generated = await generateApiKey(process.env.API_KEY_PREFIX ?? 'wgw_live');

  await prisma.apiKey.create({
    data: {
      applicationId: app.id,
      name: 'seed',
      prefix: generated.prefix,
      hash: generated.hash,
      scopes: [],
    },
  });

  console.log('');
  console.log('  Nova API key — anote agora:');
  console.log('');
  console.log(`    ${generated.plaintext}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error('Falha:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
