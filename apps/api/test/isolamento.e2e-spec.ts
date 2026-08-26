import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { criarAplicacaoComChave, criarApp, limparBanco, tokenAdmin } from './app.factory';
import {
  conectar,
  iniciarWahaMock,
  limparWahaMock,
  pararWahaMock,
  sessoesFalsas,
} from './waha-mock';

import type { INestApplication } from '@nestjs/common';

/**
 * Isolamento entre aplicações — a garantia mais importante da API.
 *
 * Uma falha aqui significa um sistema integrador conseguindo enviar mensagens
 * pelo número de outro, ou lendo conversas alheias. Cada rota que aceita um id
 * de recurso é testada com a credencial errada.
 *
 * O resultado esperado é sempre **404, nunca 403**: um 403 confirmaria que o id
 * existe, permitindo mapear os recursos de outra aplicação por tentativa.
 */
describe('isolamento entre aplicações (e2e)', () => {
  let app: INestApplication;
  let servidor: unknown;
  let request: typeof import('supertest').default;

  let chaveA: string;
  let chaveB: string;
  let sessaoA: string;
  let mensagemA: string;
  let endpointA: string;

  beforeAll(async () => {
    iniciarWahaMock();
    app = await criarApp();
    servidor = app.getHttpServer();
    ({ default: request } = await import('supertest'));
  });

  afterAll(async () => {
    await app.close();
    await pararWahaMock();
  });

  beforeEach(async () => {
    limparWahaMock();
    await limparBanco(app);

    const token = await tokenAdmin(app);

    const a = await criarAplicacaoComChave(app, token, 'Sistema A');
    const b = await criarAplicacaoComChave(app, token, 'Sistema B');

    chaveA = a.apiKey;
    chaveB = b.apiKey;

    // Sessão da aplicação A, conectada.
    const sessao = await request(servidor)
      .post('/v1/sessions')
      .set('x-api-key', chaveA)
      .send({ label: 'Comercial' })
      .expect(201);

    sessaoA = (sessao.body as { id: string }).id;

    // Conecta a sessão no dublê e sincroniza pelo caminho normal.
    const nomeInterno = [...sessoesFalsas.keys()][0]!;
    conectar(nomeInterno);

    await request(servidor).get(`/v1/sessions/${sessaoA}`).set('x-api-key', chaveA).expect(200);

    // Uma mensagem da aplicação A.
    const mensagem = await request(servidor)
      .post('/v1/messages/text')
      .set('x-api-key', chaveA)
      .send({ sessionId: sessaoA, to: '5511999999999', text: 'olá' })
      .expect(201);

    mensagemA = (mensagem.body as { id: string }).id;

    // Um endpoint de webhook da aplicação A.
    const endpoint = await request(servidor)
      .post('/v1/webhook-endpoints')
      .set('x-api-key', chaveA)
      .send({ url: 'http://127.0.0.1:9999/hook', events: ['*'] })
      .expect(201);

    endpointA = (endpoint.body as { id: string }).id;
  });

  describe('sessões', () => {
    it.each([
      ['GET detalhe', 'get', () => `/v1/sessions/${sessaoA}`],
      ['GET qr', 'get', () => `/v1/sessions/${sessaoA}/qr`],
      ['GET qr.png', 'get', () => `/v1/sessions/${sessaoA}/qr.png`],
      ['GET chats', 'get', () => `/v1/sessions/${sessaoA}/chats`],
      ['POST start', 'post', () => `/v1/sessions/${sessaoA}/start`],
      ['POST stop', 'post', () => `/v1/sessions/${sessaoA}/stop`],
      ['POST restart', 'post', () => `/v1/sessions/${sessaoA}/restart`],
      ['POST logout', 'post', () => `/v1/sessions/${sessaoA}/logout`],
      ['DELETE', 'delete', () => `/v1/sessions/${sessaoA}`],
      ['PATCH', 'patch', () => `/v1/sessions/${sessaoA}`],
    ])('%s da aplicação A com a chave da B devolve 404', async (_caso, metodo, caminho) => {
      const resposta = await (request(servidor) as never as Record<string, CallableFunction>)[
        metodo
      ]!(caminho()).set('x-api-key', chaveB);

      expect(resposta.status).toBe(404);
      // Nunca 403: confirmaria a existência do id.
      expect(resposta.status).not.toBe(403);
    });

    it('a listagem da aplicação B não inclui sessões da A', async () => {
      const resposta = await request(servidor)
        .get('/v1/sessions')
        .set('x-api-key', chaveB)
        .expect(200);

      expect(resposta.body).toEqual([]);
    });
  });

  describe('mensagens', () => {
    it('enviar pela sessão da A com a chave da B devolve 404', async () => {
      await request(servidor)
        .post('/v1/messages/text')
        .set('x-api-key', chaveB)
        .send({ sessionId: sessaoA, to: '5511999999999', text: 'invasão' })
        .expect(404);
    });

    it('ler a mensagem da A com a chave da B devolve 404', async () => {
      await request(servidor).get(`/v1/messages/${mensagemA}`).set('x-api-key', chaveB).expect(404);
    });

    it('baixar a mídia da A com a chave da B devolve 404', async () => {
      await request(servidor).get(`/v1/media/${mensagemA}`).set('x-api-key', chaveB).expect(404);
    });

    it('o histórico da aplicação B vem vazio', async () => {
      const resposta = await request(servidor)
        .get('/v1/messages')
        .set('x-api-key', chaveB)
        .expect(200);

      expect((resposta.body as { data: unknown[] }).data).toEqual([]);
    });

    it('filtrar pela sessão da A com a chave da B devolve 404, não lista vazia', async () => {
      // Lista vazia pareceria "não há mensagens" — o 404 é honesto.
      await request(servidor)
        .get(`/v1/messages?sessionId=${sessaoA}`)
        .set('x-api-key', chaveB)
        .expect(404);
    });
  });

  describe('webhooks', () => {
    it('ler o endpoint da A com a chave da B devolve 404', async () => {
      await request(servidor)
        .get(`/v1/webhook-endpoints/${endpointA}`)
        .set('x-api-key', chaveB)
        .expect(404);
    });

    it('as entregas do endpoint da A devolvem 404', async () => {
      await request(servidor)
        .get(`/v1/webhook-endpoints/${endpointA}/deliveries`)
        .set('x-api-key', chaveB)
        .expect(404);
    });

    it('a listagem da aplicação B vem vazia', async () => {
      const resposta = await request(servidor)
        .get('/v1/webhook-endpoints')
        .set('x-api-key', chaveB)
        .expect(200);

      expect(resposta.body).toEqual([]);
    });
  });

  describe('credenciais', () => {
    it('sem chave devolve 401', async () => {
      await request(servidor).get('/v1/sessions').expect(401);
    });

    it('chave revogada para de funcionar imediatamente', async () => {
      const token = await tokenAdmin(app);

      const chaves = await request(servidor).get('/v1/me').set('x-api-key', chaveB).expect(200);

      const keyId = (chaves.body as { apiKey: { id: string } }).apiKey.id;

      await request(servidor)
        .delete(`/admin/api-keys/${keyId}?force=true`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      await request(servidor).get('/v1/me').set('x-api-key', chaveB).expect(401);
    });
  });
});
