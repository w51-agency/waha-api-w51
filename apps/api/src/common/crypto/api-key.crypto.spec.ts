import { describe, expect, it } from 'vitest';

import {
  generateApiKey,
  generateSecret,
  parseApiKey,
  safeCompare,
  verifyApiKeySecret,
} from './api-key.crypto';

describe('api-key.crypto', () => {
  describe('generateApiKey', () => {
    it('produz uma chave no formato prefixo_lookup_segredo', async () => {
      const { plaintext, prefix } = await generateApiKey('wgw_live');

      expect(plaintext.startsWith(`${prefix}_`)).toBe(true);
      expect(prefix).toMatch(/^wgw_live_[0-9a-f]{12}$/);
    });

    it('nunca repete o segredo entre duas gerações', async () => {
      const a = await generateApiKey('wgw_live');
      const b = await generateApiKey('wgw_live');

      expect(a.plaintext).not.toBe(b.plaintext);
      expect(a.prefix).not.toBe(b.prefix);
      expect(a.hash).not.toBe(b.hash);
    });

    it('usa base62 no segredo, sem caracteres que precisem de escape em URL', async () => {
      const { plaintext } = await generateApiKey('wgw_live');
      const secret = plaintext.slice(plaintext.lastIndexOf('_') + 1);

      expect(secret).toMatch(/^[A-Za-z0-9]+$/);
      expect(encodeURIComponent(secret)).toBe(secret);
    });

    it('produz hash argon2id, não o segredo em claro', async () => {
      const { plaintext, hash } = await generateApiKey('wgw_live');

      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(hash).not.toContain(plaintext);
    });
  });

  describe('parseApiKey', () => {
    it('separa corretamente uma chave gerada', async () => {
      const { plaintext, prefix } = await generateApiKey('wgw_live');
      const parsed = parseApiKey(plaintext);

      expect(parsed?.prefix).toBe(prefix);
      expect(parsed?.secret).toBe(plaintext.slice(prefix.length + 1));
    });

    it('tolera espaços em volta — copiar e colar costuma trazê-los', async () => {
      const { plaintext, prefix } = await generateApiKey('wgw_live');

      expect(parseApiKey(`  ${plaintext}\n`)?.prefix).toBe(prefix);
    });

    it.each([
      ['string vazia', ''],
      ['sem separador', 'chavequalquer'],
      ['sem segredo', 'wgw_live_a1b2c3d4e5f6_'],
      ['lookup curto demais', 'wgw_live_abc_segredo'],
      ['lookup não hexadecimal', 'wgw_live_zzzzzzzzzzzz_segredo'],
      ['número em vez de texto', 12345],
      ['nulo', null],
      ['indefinido', undefined],
      ['objeto', { chave: 'valor' }],
    ])('rejeita %s sem lançar', (_caso, entrada) => {
      expect(parseApiKey(entrada)).toBeNull();
    });
  });

  describe('verifyApiKeySecret', () => {
    it('aceita o segredo correto', async () => {
      const { plaintext, hash } = await generateApiKey('wgw_live');
      const { secret } = parseApiKey(plaintext)!;

      expect(await verifyApiKeySecret(secret, hash)).toBe(true);
    });

    it('rejeita segredo adulterado em um único caractere', async () => {
      const { plaintext, hash } = await generateApiKey('wgw_live');
      const { secret } = parseApiKey(plaintext)!;
      const adulterado = `${secret.slice(0, -1)}${secret.at(-1) === 'a' ? 'b' : 'a'}`;

      expect(await verifyApiKeySecret(adulterado, hash)).toBe(false);
    });

    it('rejeita o segredo de outra chave', async () => {
      const a = await generateApiKey('wgw_live');
      const b = await generateApiKey('wgw_live');

      expect(await verifyApiKeySecret(parseApiKey(b.plaintext)!.secret, a.hash)).toBe(false);
    });

    it('devolve false em vez de lançar quando o hash é lixo', async () => {
      expect(await verifyApiKeySecret('qualquer', 'nao-e-um-hash')).toBe(false);
      expect(await verifyApiKeySecret('qualquer', '')).toBe(false);
    });
  });

  describe('safeCompare', () => {
    it('compara corretamente', () => {
      expect(safeCompare('abc', 'abc')).toBe(true);
      expect(safeCompare('abc', 'abd')).toBe(false);
    });

    it('trata tamanhos diferentes sem lançar — timingSafeEqual exigiria igualdade', () => {
      expect(safeCompare('curto', 'bem mais longo')).toBe(false);
      expect(safeCompare('', 'x')).toBe(false);
      expect(safeCompare('', '')).toBe(true);
    });
  });

  describe('generateSecret', () => {
    it('gera valores distintos e sem caracteres especiais', () => {
      const a = generateSecret(32);
      const b = generateSecret(32);

      expect(a).not.toBe(b);
      expect(a).toMatch(/^[A-Za-z0-9]+$/);
    });
  });
});
