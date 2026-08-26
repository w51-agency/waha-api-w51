import { BadRequestException, ConflictException, RequestTimeoutException } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IdempotencyInterceptor } from './idempotency.interceptor';

import type { MessagesService } from './messages.service';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

/**
 * Testes da idempotência de envio.
 *
 * O comportamento crítico não é o replay — é **quando a chave é liberada**. Ela
 * só pode ser liberada quando a não-entrega é certa; em falhas onde a entrega
 * ficou em aberto (timeout), reter a chave é o que impede um retry de duplicar
 * a mensagem no aparelho do destinatário.
 */
describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let messages: {
    buscarIdempotente: ReturnType<typeof vi.fn>;
    reservarIdempotencia: ReturnType<typeof vi.fn>;
    registrarIdempotencia: ReturnType<typeof vi.fn>;
    liberarIdempotencia: ReturnType<typeof vi.fn>;
  };
  let headers: Record<string, string>;
  let response: { setHeader: ReturnType<typeof vi.fn> };

  const resultado = { id: 'msg-1', status: 'SENT', chatId: '5511999999999@c.us' };

  function contexto(): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers, apiKey: { application: { id: 'app-1' } } }),
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
  }

  const handler = (obs = of(resultado)): CallHandler => ({ handle: () => obs });

  beforeEach(() => {
    headers = { 'idempotency-key': 'chave-do-cliente' };
    response = { setHeader: vi.fn() };
    messages = {
      buscarIdempotente: vi.fn().mockResolvedValue(null),
      reservarIdempotencia: vi.fn().mockResolvedValue(true),
      registrarIdempotencia: vi.fn().mockResolvedValue(undefined),
      liberarIdempotencia: vi.fn().mockResolvedValue(undefined),
    };
    interceptor = new IdempotencyInterceptor(messages as unknown as MessagesService);
  });

  it('passa direto quando não há Idempotency-Key', async () => {
    headers = {};

    await firstValueFrom(await interceptor.intercept(contexto(), handler()));

    expect(messages.reservarIdempotencia).not.toHaveBeenCalled();
  });

  it('reserva a chave e registra o resultado no sucesso', async () => {
    const r = await firstValueFrom(await interceptor.intercept(contexto(), handler()));

    expect(r).toEqual(resultado);
    expect(messages.reservarIdempotencia).toHaveBeenCalledWith('chave-do-cliente', 'app-1');
    expect(messages.registrarIdempotencia).toHaveBeenCalledWith(
      'chave-do-cliente',
      'app-1',
      resultado,
    );
  });

  it('devolve o resultado original na repetição, marcando o header', async () => {
    messages.buscarIdempotente.mockResolvedValue(resultado);
    const chamou = vi.fn();

    const r = await firstValueFrom(
      await interceptor.intercept(contexto(), { handle: () => (chamou(), of(resultado)) }),
    );

    expect(r).toEqual(resultado);
    expect(chamou).not.toHaveBeenCalled(); // não reenviou
    expect(response.setHeader).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
  });

  it('recusa requisição concorrente com a mesma chave', async () => {
    messages.buscarIdempotente.mockResolvedValue('em-andamento');

    await expect(
      firstValueFrom(await interceptor.intercept(contexto(), handler())),
    ).rejects.toThrow(ConflictException);
  });

  it('recusa quando a reserva perde a corrida', async () => {
    messages.reservarIdempotencia.mockResolvedValue(false);

    await expect(
      firstValueFrom(await interceptor.intercept(contexto(), handler())),
    ).rejects.toThrow(ConflictException);
  });

  describe('liberação da chave em caso de erro', () => {
    it('LIBERA quando a não-entrega é certa (4xx) — o cliente corrige e repete', async () => {
      const erro = throwError(() => new BadRequestException('destinatário inválido'));

      await expect(
        firstValueFrom(await interceptor.intercept(contexto(), handler(erro))),
      ).rejects.toThrow();

      expect(messages.liberarIdempotencia).toHaveBeenCalledWith('chave-do-cliente', 'app-1');
    });

    it('RETÉM quando a entrega é incerta (timeout) — repetir duplicaria a mensagem', async () => {
      const erro = throwError(() => new RequestTimeoutException('sem resposta'));

      await expect(
        firstValueFrom(await interceptor.intercept(contexto(), handler(erro))),
      ).rejects.toThrow();

      expect(messages.liberarIdempotencia).not.toHaveBeenCalled();
    });

    it('RETÉM em erro genérico de conexão — a entrega também fica em aberto', async () => {
      const erro = throwError(() => new Error('ECONNRESET'));

      await expect(
        firstValueFrom(await interceptor.intercept(contexto(), handler(erro))),
      ).rejects.toThrow();

      expect(messages.liberarIdempotencia).not.toHaveBeenCalled();
    });

    it('RETÉM em 429 — pode ter sido aceito antes do limite', async () => {
      const erro = throwError(() => new ConflictException('x'));
      Object.assign((erro as never)['source'] ?? {}, {});

      const tooMany = throwError(() => ({ status: 429, message: 'rate limited' }));

      await expect(
        firstValueFrom(await interceptor.intercept(contexto(), handler(tooMany))),
      ).rejects.toBeDefined();

      expect(messages.liberarIdempotencia).not.toHaveBeenCalled();
      void erro;
    });
  });
});
