import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../src/prisma/prisma.service';

import { criarAplicacaoComChave, criarApp, limparBanco, tokenAdmin } from './app.factory';
import {
  conectar,
  controle,
  iniciarWahaMock,
  limparWahaMock,
  pararWahaMock,
  sessoesFalsas,
} from './waha-mock';

import type { INestApplication } from '@nestjs/common';

/**
 * O fluxo completo do produto, ponta a ponta.
 *
 * Cobre o caminho que o `.plan/start.md` descreve: um sistema pede um QR code,
 * o número conecta, o vínculo fica registrado, e as mensagens passam a fluir —
 * com a trilha de auditoria mostrando quem pediu o quê.
 */
describe('fluxo completo (e2e)', () => {
  let app: INestApplication;
  let servidor: unknown;
  let request: typeof import('supertest').default;
  let prisma: PrismaService;

  beforeAll(async () => {
    iniciarWahaMock();
    app = await criarApp();
    servidor = app.getHttpServer();
    prisma = app.get(PrismaService);
    ({ default: request } = await import('supertest'));
  });

  afterAll(async () => {
    await app.close();
    await pararWahaMock();
  });

  beforeEach(async () => {
    limparWahaMock();
    await limparBanco(app);
  });

  it('do cadastro da aplicação ao envio de mensagem', async () => {
    const token = await tokenAdmin(app);
    const { apiKey, slug } = await criarAplicacaoComChave(app, token, 'CRM Vendas');

    // --- 1. a chave funciona e diz o que pode ---
    const conta = await request(servidor).get('/v1/me').set('x-api-key', apiKey).expect(200);

    expect((conta.body as { application: { slug: string } }).application.slug).toBe(slug);

    // --- 2. cria a sessão ---
    const sessao = await request(servidor)
      .post('/v1/sessions')
      .set('x-api-key', apiKey)
      .send({ label: 'Comercial' })
      .expect(201);

    const sessaoId = (sessao.body as { id: string }).id;

    // O carimbo de rastreio precisa ter chegado ao WAHA: é ele que torna todo
    // evento posterior identificável.
    const nomeInterno = [...sessoesFalsas.keys()][0]!;
    const metadata = sessoesFalsas.get(nomeInterno)!.config?.metadata as Record<string, string>;

    expect(metadata['application.slug']).toBe(slug);
    expect(metadata['gateway.session.id']).toBe(sessaoId);
    expect(metadata['created.by.apikey']).toBeTruthy();

    // --- 3. pede o QR, e o pedido fica registrado ---
    const qr = await request(servidor)
      .get(`/v1/sessions/${sessaoId}/qr`)
      .set('x-api-key', apiKey)
      .expect(200);

    expect((qr.body as { value: string }).value).toContain('wa.me');
    expect((qr.body as { expiresInSeconds: number }).expiresInSeconds).toBeGreaterThan(0);

    const apos1Qr = await request(servidor)
      .get(`/v1/sessions/${sessaoId}`)
      .set('x-api-key', apiKey)
      .expect(200);

    expect((apos1Qr.body as { qrRequestCount: number }).qrRequestCount).toBe(1);

    // --- 4. o número conecta (webhook do WAHA) ---
    const sessaoDb = await prisma.session.findUniqueOrThrow({ where: { id: sessaoId } });

    await enviarWebhook(servidor, request, sessaoDb.webhookSecret, {
      id: `evt_${Date.now()}`,
      timestamp: Date.now(),
      event: 'session.status',
      session: nomeInterno,
      metadata,
      me: { id: '5511988887777@c.us', pushName: 'Comercial da Empresa' },
      payload: { status: 'WORKING' },
    });

    conectar(nomeInterno);

    const conectada = await request(servidor)
      .get(`/v1/sessions/${sessaoId}`)
      .set('x-api-key', apiKey)
      .expect(200);

    const corpo = conectada.body as { status: string; phoneNumber: string; connectedAt: string };

    // É aqui que o requisito central se completa.
    expect(corpo.status).toBe('WORKING');
    expect(corpo.phoneNumber).toBe('5511988887777');
    expect(corpo.connectedAt).toBeTruthy();

    // --- 5. envia uma mensagem ---
    const enviada = await request(servidor)
      .post('/v1/messages/text')
      .set('x-api-key', apiKey)
      .send({ sessionId: sessaoId, to: '5511999999999', text: 'Pedido confirmado' })
      .expect(201);

    const mensagem = enviada.body as { id: string; status: string; chatId: string };

    expect(mensagem.status).toBe('SENT');
    expect(mensagem.chatId).toBe('5511999999999@c.us');

    // A atribuição é o que permite responder "quem enviou".
    const registro = await prisma.message.findUniqueOrThrow({ where: { id: mensagem.id } });
    expect(registro.sentByApiKeyId).toBeTruthy();

    // --- 6. o histórico reflete tudo ---
    const historico = await request(servidor)
      .get(`/v1/messages?sessionId=${sessaoId}`)
      .set('x-api-key', apiKey)
      .expect(200);

    expect((historico.body as { data: unknown[] }).data).toHaveLength(1);

    // --- 7. a trilha de auditoria conta a história ---
    const auditoria = await prisma.auditLog.findMany({
      where: { resourceId: sessaoId },
      orderBy: { createdAt: 'asc' },
    });

    const acoes = auditoria.map((a) => a.action);
    expect(acoes).toContain('session.created');
    expect(acoes).toContain('session.qr.requested');
  });

  describe('idempotência de envio', () => {
    it('a mesma chave devolve o resultado original em vez de reenviar', async () => {
      const token = await tokenAdmin(app);
      const { apiKey } = await criarAplicacaoComChave(app, token, 'Sistema');
      const sessaoId = await sessaoConectada(servidor, request, apiKey);

      const chave = `teste-${Date.now()}`;
      const corpo = { sessionId: sessaoId, to: '5511999999999', text: 'uma vez só' };

      const primeira = await request(servidor)
        .post('/v1/messages/text')
        .set('x-api-key', apiKey)
        .set('idempotency-key', chave)
        .send(corpo)
        .expect(201);

      const segunda = await request(servidor)
        .post('/v1/messages/text')
        .set('x-api-key', apiKey)
        .set('idempotency-key', chave)
        .send(corpo)
        .expect(201);

      expect((segunda.body as { id: string }).id).toBe((primeira.body as { id: string }).id);
      expect(segunda.headers['idempotency-replayed']).toBe('true');

      // O que realmente importa: uma mensagem só saiu.
      const enviadas = await prisma.message.count({ where: { body: 'uma vez só' } });
      expect(enviadas).toBe(1);
    });

    it('falha de não-entrega certa libera a chave para nova tentativa', async () => {
      const token = await tokenAdmin(app);
      const { apiKey } = await criarAplicacaoComChave(app, token, 'Sistema');
      const sessaoId = await sessaoConectada(servidor, request, apiKey);

      const chave = `teste-${Date.now()}`;
      const corpo = { sessionId: sessaoId, to: '5511999999999', text: 'tentativa' };

      controle.falharProximoEnvio = true;

      await request(servidor)
        .post('/v1/messages/text')
        .set('x-api-key', apiKey)
        .set('idempotency-key', chave)
        .send(corpo)
        .expect(422);

      // Como a não-entrega é certa (4xx), a chave foi liberada e o cliente pode
      // repetir depois de corrigir.
      await request(servidor)
        .post('/v1/messages/text')
        .set('x-api-key', apiKey)
        .set('idempotency-key', chave)
        .send(corpo)
        .expect(201);
    });
  });

  describe('ingestão de webhooks do WAHA', () => {
    it('recusa assinatura inválida', async () => {
      const token = await tokenAdmin(app);
      const { apiKey } = await criarAplicacaoComChave(app, token, 'Sistema');
      const sessaoId = await sessaoConectada(servidor, request, apiKey);
      const sessaoDb = await prisma.session.findUniqueOrThrow({ where: { id: sessaoId } });

      const evento = {
        id: 'evt_forjado',
        timestamp: Date.now(),
        event: 'message',
        session: sessaoDb.name,
        payload: { id: 'm1', from: '5511977776666@c.us', fromMe: false, body: 'x', timestamp: 1 },
      };

      await request(servidor)
        .post('/internal/waha/webhook')
        .set('content-type', 'application/json')
        .set('x-webhook-hmac', 'assinatura-forjada')
        .set('x-webhook-timestamp', String(Date.now()))
        .send(JSON.stringify(evento))
        .expect(401);

      expect(await prisma.message.count()).toBe(0);
    });

    it('reentrega do mesmo evento não duplica a mensagem', async () => {
      const token = await tokenAdmin(app);
      const { apiKey } = await criarAplicacaoComChave(app, token, 'Sistema');
      const sessaoId = await sessaoConectada(servidor, request, apiKey);
      const sessaoDb = await prisma.session.findUniqueOrThrow({ where: { id: sessaoId } });

      const evento = {
        id: 'evt_repetido',
        timestamp: Date.now(),
        event: 'message',
        session: sessaoDb.name,
        payload: {
          id: 'msg_repetida',
          from: '5511977776666@c.us',
          fromMe: false,
          body: 'chegou uma vez',
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      const resultados: string[] = [];

      // O WAHA retenta até 15 vezes; cinco bastam para provar a trava.
      for (let i = 0; i < 5; i++) {
        const r = await enviarWebhook(servidor, request, sessaoDb.webhookSecret, evento);
        resultados.push((r.body as { status: string }).status);
      }

      expect(resultados[0]).toBe('processado');
      expect(resultados.slice(1)).toEqual(['duplicado', 'duplicado', 'duplicado', 'duplicado']);
      expect(await prisma.message.count({ where: { wahaId: 'msg_repetida' } })).toBe(1);
    });

    it('o status da mensagem nunca regride com acks fora de ordem', async () => {
      const token = await tokenAdmin(app);
      const { apiKey } = await criarAplicacaoComChave(app, token, 'Sistema');
      const sessaoId = await sessaoConectada(servidor, request, apiKey);
      const sessaoDb = await prisma.session.findUniqueOrThrow({ where: { id: sessaoId } });

      await enviarWebhook(servidor, request, sessaoDb.webhookSecret, {
        id: 'evt_msg',
        timestamp: Date.now(),
        event: 'message',
        session: sessaoDb.name,
        payload: {
          id: 'msg_ack',
          from: '5511977776666@c.us',
          fromMe: true,
          to: '5511977776666@c.us',
          body: 'ok',
          timestamp: Math.floor(Date.now() / 1000),
        },
      });

      const aplicarAck = async (ack: number, indice: number) =>
        enviarWebhook(servidor, request, sessaoDb.webhookSecret, {
          id: `evt_ack_${indice}`,
          timestamp: Date.now(),
          event: 'message.ack',
          session: sessaoDb.name,
          payload: { id: 'msg_ack', ack },
        });

      await aplicarAck(3, 1); // lida
      await aplicarAck(1, 2); // servidor — atrasado

      const mensagem = await prisma.message.findFirstOrThrow({ where: { wahaId: 'msg_ack' } });

      // Sem a comparação de ordem, o painel mostraria a mensagem voltando no tempo.
      expect(mensagem.status).toBe('READ');
    });
  });
});

// =============================================================================
//  Apoio
// =============================================================================

/** Cria e conecta uma sessão, devolvendo o id. */
async function sessaoConectada(
  servidor: unknown,
  request: typeof import('supertest').default,
  apiKey: string,
): Promise<string> {
  const sessao = await request(servidor)
    .post('/v1/sessions')
    .set('x-api-key', apiKey)
    .send({ label: `Sessão ${Math.random().toString(36).slice(2, 7)}` })
    .expect(201);

  const id = (sessao.body as { id: string }).id;
  const nome = [...sessoesFalsas.keys()].at(-1)!;

  conectar(nome);

  await request(servidor).get(`/v1/sessions/${id}`).set('x-api-key', apiKey).expect(200);

  return id;
}

/** Assina e entrega um evento como o WAHA faria. */
async function enviarWebhook(
  servidor: unknown,
  request: typeof import('supertest').default,
  segredo: string,
  evento: Record<string, unknown>,
) {
  const corpo = JSON.stringify(evento);

  return request(servidor)
    .post('/internal/waha/webhook')
    .set('content-type', 'application/json')
    .set('x-webhook-hmac', createHmac('sha512', segredo).update(corpo).digest('hex'))
    .set('x-webhook-hmac-algorithm', 'sha512')
    .set('x-webhook-timestamp', String(Date.now()))
    .send(corpo)
    .expect(200);
}
