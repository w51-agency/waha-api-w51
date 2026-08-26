import { Test } from '@nestjs/testing';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppConfig } from '../../config';

import { WahaClient } from './waha.client';
import {
  WahaAuthError,
  WahaSessionNotFoundError,
  WahaUnavailableError,
  WahaValidationError,
} from './waha.errors';

const BASE = 'http://waha-teste:3000';

/**
 * O cliente cria o próprio `Agent` no construtor e o passa como `dispatcher`.
 * Para interceptar, substituímos esse campo pelo MockAgent depois de instanciar.
 */
function comMock(client: WahaClient, agent: MockAgent): WahaClient {
  (client as unknown as { agent: unknown }).agent = agent;
  return client;
}

describe('WahaClient', () => {
  let client: WahaClient;
  let agent: MockAgent;

  const config: Record<string, string | number> = {
    WAHA_BASE_URL: BASE,
    WAHA_API_KEY: 'chave-de-teste',
    WAHA_TIMEOUT_MS: 500,
  };

  beforeEach(async () => {
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);

    const moduleRef = await Test.createTestingModule({
      providers: [WahaClient, { provide: AppConfig, useValue: { get: (k: string) => config[k] } }],
    }).compile();

    client = comMock(moduleRef.get(WahaClient), agent);
  });

  afterEach(async () => {
    await agent.close();
  });

  describe('sessões', () => {
    it('cria sessão enviando o metadata de rastreio', async () => {
      let corpoRecebido: string | undefined;

      agent
        .get(BASE)
        .intercept({ path: '/api/sessions', method: 'POST' })
        .reply(201, (opts) => {
          corpoRecebido = opts.body as string;
          return { name: 'crm--abc', status: 'STARTING' };
        });

      const sessao = await client.createSession({
        name: 'crm--abc',
        start: true,
        config: { metadata: { 'application.id': 'app-1' } },
      });

      expect(sessao.status).toBe('STARTING');
      expect(JSON.parse(corpoRecebido!).config.metadata['application.id']).toBe('app-1');
    });

    it('envia a API key em todo request', async () => {
      let chave: string | undefined;

      agent
        .get(BASE)
        .intercept({ path: '/api/sessions', method: 'GET' })
        .reply(200, (opts) => {
          chave = (opts.headers as Record<string, string>)['x-api-key'];
          return [];
        });

      await client.listSessions();

      expect(chave).toBe('chave-de-teste');
    });
  });

  describe('tradução de erros', () => {
    it('404 vira WahaSessionNotFoundError com o nome da sessão', async () => {
      agent
        .get(BASE)
        .intercept({ path: '/api/sessions/sumiu', method: 'GET' })
        .reply(404, { message: 'not found' });

      const erro = await client.getSession('sumiu').catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(WahaSessionNotFoundError);
      expect((erro as Error).message).toMatch(/sumiu/);
    });

    it('422 vira WahaValidationError preservando a mensagem do WAHA', async () => {
      agent
        .get(BASE)
        .intercept({ path: '/api/sendText', method: 'POST' })
        .reply(422, { message: 'chatId inválido' });

      await expect(client.sendText({ session: 's', chatId: 'x', text: 'oi' })).rejects.toThrow(
        /chatId inválido/,
      );
    });

    it('401 vira WahaAuthError apontando a variável de ambiente', async () => {
      agent.get(BASE).intercept({ path: '/api/sessions', method: 'GET' }).reply(401, {});

      const erro = await client.listSessions().catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(WahaAuthError);
      expect((erro as Error).message).toMatch(/WAHA_API_KEY/);
    });

    it('5xx persistente vira WahaUnavailableError', async () => {
      agent
        .get(BASE)
        .intercept({ path: '/api/sessions', method: 'GET' })
        .reply(503, 'indisponível')
        .times(3);

      await expect(client.listSessions()).rejects.toThrow(WahaUnavailableError);
    });
  });

  describe('retentativa', () => {
    it('repete GET em 5xx e converge quando o serviço volta', async () => {
      const pool = agent.get(BASE);
      pool.intercept({ path: '/api/sessions', method: 'GET' }).reply(500, 'erro');
      pool.intercept({ path: '/api/sessions', method: 'GET' }).reply(200, [{ name: 'ok' }]);

      const sessoes = await client.listSessions();

      expect(sessoes).toHaveLength(1);
    });

    it('NÃO repete envio de mensagem — retentar duplicaria a mensagem no destinatário', async () => {
      let chamadas = 0;

      agent
        .get(BASE)
        .intercept({ path: '/api/sendText', method: 'POST' })
        .reply(() => {
          chamadas++;
          return { statusCode: 500, data: 'erro' };
        })
        .times(3);

      await expect(
        client.sendText({ session: 's', chatId: '5511999999999@c.us', text: 'oi' }),
      ).rejects.toThrow();

      expect(chamadas).toBe(1);
    });

    it('não repete 4xx — o pedido está errado, insistir não conserta', async () => {
      let chamadas = 0;

      agent
        .get(BASE)
        .intercept({ path: '/api/sessions/x', method: 'GET' })
        .reply(() => {
          chamadas++;
          return { statusCode: 404, data: {} };
        })
        .times(3);

      await expect(client.getSession('x')).rejects.toThrow(WahaSessionNotFoundError);

      expect(chamadas).toBe(1);
    });
  });

  describe('healthCheck', () => {
    it('devolve true quando o WAHA responde 200', async () => {
      agent.get(BASE).intercept({ path: '/health', method: 'GET' }).reply(200, { status: 'ok' });

      expect(await client.healthCheck()).toBe(true);
    });

    it('devolve false em vez de lançar quando está fora do ar', async () => {
      agent.get(BASE).intercept({ path: '/health', method: 'GET' }).reply(503, {});

      expect(await client.healthCheck()).toBe(false);
    });
  });
});
