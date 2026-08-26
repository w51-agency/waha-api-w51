import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateApiKey } from '../../common/crypto/api-key.crypto';
import { UnauthorizedError } from '../../common/errors/problem-details';
import { AppConfig } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';

import { ApiKeyService } from './api-key.service';

/**
 * Testes do serviço de autenticação por API key.
 *
 * O Prisma é dublado: estes testes cobrem a lógica de decisão (o que conta como
 * chave válida, quando o cache é usado, quando é invalidado) e devem rodar sem
 * banco. A integração real é coberta pelos testes e2e da tarefa 20.
 */
describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let findUnique: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;

  const aplicacaoAtiva = { id: 'app-1', name: 'CRM', slug: 'crm', active: true };

  function registro(overrides: Record<string, unknown> = {}) {
    return {
      id: 'key-1',
      name: 'produção',
      prefix: 'wgw_live_a1b2c3d4e5f6',
      hash: '',
      scopes: [] as string[],
      revokedAt: null,
      expiresAt: null,
      application: aplicacaoAtiva,
      ...overrides,
    };
  }

  beforeEach(async () => {
    findUnique = vi.fn();
    update = vi.fn().mockResolvedValue({});

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        { provide: PrismaService, useValue: { apiKey: { findUnique, update } } },
        { provide: AppConfig, useValue: { get: () => 'wgw_live' } },
      ],
    }).compile();

    service = moduleRef.get(ApiKeyService);
  });

  it('autentica uma chave válida e devolve a aplicação dona', async () => {
    const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
    findUnique.mockResolvedValue(registro({ prefix, hash }));

    const identidade = await service.authenticate(plaintext);

    expect(identidade.application.slug).toBe('crm');
    expect(identidade.prefix).toBe(prefix);
  });

  it('concede todos os escopos quando a lista está vazia', async () => {
    const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
    findUnique.mockResolvedValue(registro({ prefix, hash, scopes: [] }));

    const identidade = await service.authenticate(plaintext);

    expect(identidade.scopes).toContain('messages:send');
    expect(identidade.scopes.length).toBeGreaterThan(1);
  });

  it('restringe aos escopos declarados quando há lista', async () => {
    const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
    findUnique.mockResolvedValue(registro({ prefix, hash, scopes: ['messages:send'] }));

    const identidade = await service.authenticate(plaintext);

    expect(identidade.scopes).toEqual(['messages:send']);
  });

  it('descarta escopo desconhecido vindo do banco', async () => {
    const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
    findUnique.mockResolvedValue(
      registro({ prefix, hash, scopes: ['messages:send', 'escopo:inventado'] }),
    );

    const identidade = await service.authenticate(plaintext);

    expect(identidade.scopes).toEqual(['messages:send']);
  });

  describe('recusa', () => {
    it('chave inexistente', async () => {
      const { plaintext } = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(null);

      await expect(service.authenticate(plaintext)).rejects.toThrow(UnauthorizedError);
    });

    it('chave revogada', async () => {
      const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(registro({ prefix, hash, revokedAt: new Date() }));

      await expect(service.authenticate(plaintext)).rejects.toThrow(UnauthorizedError);
    });

    it('chave expirada', async () => {
      const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(
        registro({ prefix, hash, expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.authenticate(plaintext)).rejects.toThrow(UnauthorizedError);
    });

    it('aceita chave com expiração futura', async () => {
      const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(
        registro({ prefix, hash, expiresAt: new Date(Date.now() + 60_000) }),
      );

      await expect(service.authenticate(plaintext)).resolves.toBeDefined();
    });

    it('aplicação desativada', async () => {
      const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(
        registro({ prefix, hash, application: { ...aplicacaoAtiva, active: false } }),
      );

      await expect(service.authenticate(plaintext)).rejects.toThrow(UnauthorizedError);
    });

    it('segredo errado, mesmo com prefixo existente', async () => {
      const legitima = await generateApiKey('wgw_live');
      const impostora = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(registro({ prefix: legitima.prefix, hash: legitima.hash }));

      const forjada = `${legitima.prefix}_${impostora.plaintext.split('_').at(-1)}`;

      await expect(service.authenticate(forjada)).rejects.toThrow(UnauthorizedError);
    });

    it('usa a mesma mensagem para todos os motivos — não revela qual falhou', async () => {
      const { plaintext, prefix, hash } = await generateApiKey('wgw_live');

      findUnique.mockResolvedValue(null);
      const inexistente = await service.authenticate(plaintext).catch((e: Error) => e.message);

      service.invalidateCache();
      findUnique.mockResolvedValue(registro({ prefix, hash, revokedAt: new Date() }));
      const revogada = await service.authenticate(plaintext).catch((e: Error) => e.message);

      expect(inexistente).toBe(revogada);
    });
  });

  describe('cache', () => {
    it('não consulta o banco na segunda autenticação da mesma chave', async () => {
      const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(registro({ prefix, hash }));

      await service.authenticate(plaintext);
      await service.authenticate(plaintext);
      await service.authenticate(plaintext);

      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it('cacheia também a recusa, para chave inválida não martelar o banco', async () => {
      const { plaintext } = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(null);

      await service.authenticate(plaintext).catch(() => undefined);
      await service.authenticate(plaintext).catch(() => undefined);

      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache força nova consulta — é o que torna a revogação imediata', async () => {
      const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(registro({ prefix, hash }));

      await service.authenticate(plaintext);
      expect(findUnique).toHaveBeenCalledTimes(1);

      service.invalidateCache();
      findUnique.mockResolvedValue(registro({ prefix, hash, revokedAt: new Date() }));

      await expect(service.authenticate(plaintext)).rejects.toThrow(UnauthorizedError);
      expect(findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('lastUsedAt', () => {
    it('registra o uso sem bloquear a requisição', async () => {
      const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(registro({ prefix, hash }));

      await service.authenticate(plaintext);
      await new Promise((r) => setImmediate(r));

      expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'key-1' } }));
    });

    it('agrupa as escritas — várias autenticações seguidas geram uma só', async () => {
      const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(registro({ prefix, hash }));

      for (let i = 0; i < 10; i++) await service.authenticate(plaintext);
      await new Promise((r) => setImmediate(r));

      expect(update).toHaveBeenCalledTimes(1);
    });

    it('falha ao gravar lastUsedAt não derruba a autenticação', async () => {
      const { plaintext, prefix, hash } = await generateApiKey('wgw_live');
      findUnique.mockResolvedValue(registro({ prefix, hash }));
      update.mockRejectedValue(new Error('banco fora do ar'));

      await expect(service.authenticate(plaintext)).resolves.toBeDefined();
      await new Promise((r) => setImmediate(r));
    });
  });
});
