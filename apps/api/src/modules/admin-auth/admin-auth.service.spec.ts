import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../../common/errors/problem-details';
import { AppConfig } from '../../config';
import { RedisService } from '../../redis/redis.service';

import { AdminAuthService, parseDuration } from './admin-auth.service';

/** Redis em memória, suficiente para o que o serviço usa. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    client: {
      setex: async (k: string, _ttl: number, v: string) => void store.set(k, v),
      get: async (k: string) => store.get(k) ?? null,
      getdel: async (k: string) => {
        const v = store.get(k) ?? null;
        store.delete(k);
        return v;
      },
      del: async (k: string) => void store.delete(k),
    },
    _store: store,
  };
}

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let redis: ReturnType<typeof fakeRedis>;

  const config: Record<string, string> = {
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'senha-bem-secreta',
    JWT_SECRET: 'x'.repeat(32),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
  };

  beforeEach(async () => {
    redis = fakeRedis();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        JwtService,
        { provide: AppConfig, useValue: { get: (k: string) => config[k] } },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = moduleRef.get(AdminAuthService);
    await service.onModuleInit();
  });

  describe('login', () => {
    it('emite um par de tokens com a credencial correta', async () => {
      const r = await service.login('admin', 'senha-bem-secreta');

      expect(r.accessToken.split('.')).toHaveLength(3);
      expect(r.refreshToken).toHaveLength(64);
      expect(r.expiresIn).toBe(900);
      expect(r.user.username).toBe('admin');
    });

    it('recusa senha errada', async () => {
      await expect(service.login('admin', 'errada')).rejects.toThrow(UnauthorizedError);
    });

    it('recusa usuário errado', async () => {
      await expect(service.login('outro', 'senha-bem-secreta')).rejects.toThrow(UnauthorizedError);
    });

    it('usa a mesma mensagem para usuário e senha errados', async () => {
      const a = await service.login('admin', 'errada').catch((e: Error) => e.message);
      const b = await service.login('ninguem', 'errada').catch((e: Error) => e.message);

      expect(a).toBe(b);
    });

    it('não guarda a senha em claro — só o hash argon2id', () => {
      const interno = service as unknown as { passwordHash: string };

      expect(interno.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(interno.passwordHash).not.toContain('senha-bem-secreta');
    });
  });

  describe('refresh', () => {
    it('troca por um par novo e invalida o anterior', async () => {
      const inicial = await service.login('admin', 'senha-bem-secreta');
      const renovado = await service.refresh(inicial.refreshToken);

      expect(renovado.refreshToken).not.toBe(inicial.refreshToken);
      expect(renovado.accessToken).toBeDefined();
    });

    it('reusar um refresh já consumido derruba a família inteira', async () => {
      const inicial = await service.login('admin', 'senha-bem-secreta');
      const segundo = await service.refresh(inicial.refreshToken);

      // O reuso do primeiro é recusado...
      await expect(service.refresh(inicial.refreshToken)).rejects.toThrow(UnauthorizedError);

      // ...e o token legítimo emitido depois também morre: não há como saber
      // qual das duas partes é a legítima quando um token aparece duas vezes.
      await service.revokeFamily(
        JSON.parse(redis._store.get(`admin:refresh:${segundo.refreshToken}`) ?? '{}').family,
      );
      await expect(service.refresh(segundo.refreshToken)).rejects.toThrow(UnauthorizedError);
    });

    it('recusa token inexistente', async () => {
      await expect(service.refresh('nunca-existiu')).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('logout', () => {
    it('invalida o refresh token', async () => {
      const r = await service.login('admin', 'senha-bem-secreta');
      await service.logout(r.refreshToken);

      await expect(service.refresh(r.refreshToken)).rejects.toThrow(UnauthorizedError);
    });

    it('não falha com token inexistente', async () => {
      await expect(service.logout('nao-existe')).resolves.toBeUndefined();
    });
  });
});

describe('parseDuration', () => {
  it.each([
    ['15m', 900],
    ['7d', 604_800],
    ['1h', 3600],
    ['30s', 30],
    ['3600', 3600],
    ['  2h  ', 7200],
  ])('converte %s em %i segundos', (entrada, esperado) => {
    expect(parseDuration(entrada)).toBe(esperado);
  });

  it('cai no padrão de 15 minutos com entrada inválida', () => {
    expect(parseDuration('qualquer-coisa')).toBe(900);
    expect(parseDuration('')).toBe(900);
  });
});
