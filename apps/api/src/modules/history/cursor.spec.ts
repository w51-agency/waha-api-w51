import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../common/errors/problem-details';

import { cursorWhere, decodeCursor, encodeCursor } from './cursor';

describe('cursor', () => {
  const referencia = { timestamp: new Date('2026-08-26T12:34:56.789Z'), id: 'clx1a2b3c4d5' };

  it('codifica e decodifica sem perder precisão', () => {
    const decodificado = decodeCursor(encodeCursor(referencia));

    expect(decodificado.timestamp.toISOString()).toBe(referencia.timestamp.toISOString());
    expect(decodificado.id).toBe(referencia.id);
  });

  it('é opaco — o cliente não deve conseguir interpretá-lo por acidente', () => {
    const cursor = encodeCursor(referencia);

    expect(cursor).not.toContain('2026');
    expect(cursor).not.toContain(referencia.id);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, seguro em querystring
  });

  it('preserva ids que contêm o separador', () => {
    const comPipe = { timestamp: referencia.timestamp, id: 'id|com|pipes' };

    expect(decodeCursor(encodeCursor(comPipe)).id).toBe('id|com|pipes');
  });

  it.each([
    ['texto qualquer', 'nao-e-um-cursor'],
    ['string vazia', ''],
    ['base64 de lixo', Buffer.from('sem separador').toString('base64url')],
    ['data inválida', Buffer.from('data-ruim|id').toString('base64url')],
    ['id vazio', Buffer.from('2026-08-26T12:00:00.000Z|').toString('base64url')],
  ])('recusa %s', (_caso, valor) => {
    expect(() => decodeCursor(valor)).toThrow(ValidationError);
  });

  describe('cursorWhere', () => {
    it('monta a condição de continuação com desempate por id', () => {
      const where = cursorWhere(referencia);

      // Sem o desempate por id, duas mensagens com o mesmo timestamp fariam a
      // paginação pular uma delas na virada de página.
      expect(where.OR).toHaveLength(2);
      expect(where.OR[0]).toEqual({ timestamp: { lt: referencia.timestamp } });
      expect(where.OR[1]).toEqual({ timestamp: referencia.timestamp, id: { lt: referencia.id } });
    });
  });
});
