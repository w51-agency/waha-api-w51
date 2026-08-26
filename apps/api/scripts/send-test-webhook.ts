import { createHmac, randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

import { PrismaClient } from '../src/generated/prisma/client';

config({ path: '../../.env' });

/**
 * Envia um webhook assinado ao gateway, imitando o WAHA.
 *
 * Permite exercitar a ingestão sem depender de um WhatsApp real: assinatura,
 * idempotência, atualização de status e persistência de mensagem.
 *
 * Uso:
 *   tsx scripts/send-test-webhook.ts session.status WORKING [--session nome]
 *   tsx scripts/send-test-webhook.ts message [--repeat 3]
 *   tsx scripts/send-test-webhook.ts message.ack 3
 *   tsx scripts/send-test-webhook.ts --invalid-signature
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const tipo = args.find((a) => !a.startsWith('--')) ?? 'session.status';
const valor = args.filter((a) => !a.startsWith('--'))[1];

function flag(nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const temFlag = (nome: string) => args.includes(`--${nome}`);

async function main() {
  const nomeSessao = flag('session');

  const session = nomeSessao
    ? await prisma.session.findUnique({ where: { name: nomeSessao } })
    : await prisma.session.findFirst({ orderBy: { createdAt: 'desc' } });

  if (!session) {
    console.error('Nenhuma sessão encontrada. Crie uma antes de rodar este script.');
    process.exit(1);
  }

  const url = `http://localhost:${process.env.API_PORT ?? 3001}/internal/waha/webhook`;
  const repeticoes = Number(flag('repeat') ?? 1);
  const idFixo = flag('event-id');

  console.log(`sessão: ${session.name} (${session.id})`);
  console.log(`evento: ${tipo}${valor ? ` = ${valor}` : ''}`);
  console.log(`envios: ${repeticoes}`);
  console.log('');

  for (let i = 0; i < repeticoes; i++) {
    const evento = montarEvento(tipo, valor, session, idFixo);
    const corpo = JSON.stringify(evento);

    const assinatura = temFlag('invalid-signature')
      ? 'assinatura-forjada'
      : createHmac('sha512', session.webhookSecret).update(corpo).digest('hex');

    const resposta = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-hmac': assinatura,
        'x-webhook-hmac-algorithm': 'sha512',
        'x-webhook-request-id': randomUUID(),
        'x-webhook-timestamp': String(temFlag('stale') ? Date.now() - 3_600_000 : Date.now()),
      },
      body: corpo,
    });

    const texto = await resposta.text();
    console.log(`  ${i + 1}. HTTP ${resposta.status} -> ${texto}`);
  }
}

function montarEvento(
  tipo: string,
  valor: string | undefined,
  session: { name: string; id: string; applicationId: string },
  idFixo?: string,
) {
  const base = {
    id: idFixo ?? `evt_${randomUUID().replace(/-/g, '')}`,
    timestamp: Date.now(),
    event: tipo,
    session: session.name,
    metadata: {
      'application.id': session.applicationId,
      'gateway.session.id': session.id,
    },
    engine: 'NOWEB',
    environment: { tier: 'CORE', version: 'teste' },
  };

  if (tipo === 'session.status') {
    return {
      ...base,
      me: { id: '5511988887777@c.us', pushName: 'Número de Teste' },
      payload: { name: session.name, status: valor ?? 'WORKING' },
    };
  }

  if (tipo === 'message' || tipo === 'message.any') {
    return {
      ...base,
      me: { id: '5511988887777@c.us', pushName: 'Número de Teste' },
      payload: {
        id: idFixo ? `msg_${idFixo}` : `false_5511977776666@c.us_${randomUUID().slice(0, 8)}`,
        timestamp: Math.floor(Date.now() / 1000),
        from: '5511977776666@c.us',
        fromMe: false,
        body: valor ?? 'Mensagem de teste vinda do script',
        hasMedia: false,
      },
    };
  }

  if (tipo === 'message.ack') {
    return {
      ...base,
      payload: {
        id: flag('message-id') ?? 'msg-desconhecida',
        from: '5511977776666@c.us',
        fromMe: true,
        ack: Number(valor ?? 3),
        ackName: { 1: 'SERVER', 2: 'DEVICE', 3: 'READ' }[Number(valor ?? 3)] ?? 'UNKNOWN',
      },
    };
  }

  return { ...base, payload: { valor } };
}

main()
  .catch((e) => {
    console.error('falhou:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
