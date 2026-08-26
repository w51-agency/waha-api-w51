import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../common/errors/problem-details';

import { normalizeChatId, phoneFromChatId } from './chat-id';

describe('normalizeChatId', () => {
  describe('números crus', () => {
    it.each([
      ['5511999999999', '5511999999999@c.us'],
      ['+5511999999999', '5511999999999@c.us'],
      ['+55 (11) 99999-9999', '5511999999999@c.us'],
      ['55 11 99999 9999', '5511999999999@c.us'],
      ['  5511999999999  ', '5511999999999@c.us'],
    ])('normaliza %s', (entrada, esperado) => {
      expect(normalizeChatId(entrada)).toBe(esperado);
    });
  });

  describe('chatId completo', () => {
    it.each([
      '5511999999999@c.us',
      '120363012345678901@g.us',
      '120363012345678901@newsletter',
      '12345678901234@lid',
    ])('mantém %s intacto', (chatId) => {
      expect(normalizeChatId(chatId)).toBe(chatId);
    });
  });

  describe('recusas', () => {
    it('número sem código do país, com mensagem que ensina o formato', () => {
      const erro = capturar(() => normalizeChatId('999999999'));

      expect(erro).toBeInstanceOf(ValidationError);
      expect(erro.message).toMatch(/código do país/);
      expect(erro.message).toMatch(/5511999999999/);
    });

    it('número longo demais', () => {
      expect(() => normalizeChatId('1'.repeat(20))).toThrow(ValidationError);
    });

    it('string vazia', () => {
      expect(() => normalizeChatId('   ')).toThrow(ValidationError);
    });

    it('sufixo desconhecido, listando os aceitos', () => {
      const erro = capturar(() => normalizeChatId('5511999999999@inventado'));

      expect(erro.message).toMatch(/@c\.us/);
    });

    it('parte numérica inválida', () => {
      expect(() => normalizeChatId('abc@c.us')).toThrow(ValidationError);
    });
  });
});

describe('phoneFromChatId', () => {
  it('extrai o número', () => {
    expect(phoneFromChatId('5511999999999@c.us')).toBe('5511999999999');
  });
});

function capturar(fn: () => unknown): Error {
  try {
    fn();
    throw new Error('esperava uma exceção');
  } catch (e) {
    return e as Error;
  }
}
