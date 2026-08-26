import { describe, expect, it } from 'vitest';

import { assinarPayload, verificarAssinatura } from './signature';

const SEGREDO = 'segredo-do-endpoint-do-integrador';
const CORPO = JSON.stringify({ id: 'gev_1', type: 'message.received', data: { texto: 'olá' } });

describe('assinatura dos webhooks de saída', () => {
  it('gera header no formato t=<unix>,v1=<hmac>', () => {
    const { header } = assinarPayload(CORPO, SEGREDO);

    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('a verificação publicada aceita o que realmente enviamos', () => {
    const { header } = assinarPayload(CORPO, SEGREDO);

    expect(verificarAssinatura(CORPO, header, SEGREDO).valida).toBe(true);
  });

  it('recusa corpo adulterado', () => {
    const { header } = assinarPayload(CORPO, SEGREDO);
    const adulterado = CORPO.replace('olá', 'adulterado');

    expect(verificarAssinatura(adulterado, header, SEGREDO).valida).toBe(false);
  });

  it('recusa com o segredo errado', () => {
    const { header } = assinarPayload(CORPO, SEGREDO);

    expect(verificarAssinatura(CORPO, header, 'outro-segredo').valida).toBe(false);
  });

  describe('proteção contra replay', () => {
    it('recusa entrega antiga', () => {
      const umaHoraAtras = Date.now() - 3_600_000;
      const { header } = assinarPayload(CORPO, SEGREDO, umaHoraAtras);

      const r = verificarAssinatura(CORPO, header, SEGREDO, 300);

      expect(r.valida).toBe(false);
      expect(r.motivo).toMatch(/idade/);
    });

    it('o timestamp está DENTRO do que é assinado — não dá para forjá-lo', () => {
      const antigo = Date.now() - 3_600_000;
      const { assinatura } = assinarPayload(CORPO, SEGREDO, antigo);

      // Um atacante que capturou a entrega tenta trocar o timestamp por um
      // recente, mantendo a assinatura original.
      const forjado = `t=${Math.floor(Date.now() / 1000)},v1=${assinatura}`;

      expect(verificarAssinatura(CORPO, forjado, SEGREDO, 300).valida).toBe(false);
    });

    it('aceita dentro da janela de tolerância', () => {
      const doisMinutosAtras = Date.now() - 120_000;
      const { header } = assinarPayload(CORPO, SEGREDO, doisMinutosAtras);

      expect(verificarAssinatura(CORPO, header, SEGREDO, 300).valida).toBe(true);
    });
  });

  describe('headers malformados', () => {
    it.each([
      ['vazio', ''],
      ['sem v1', 't=1740000000'],
      ['sem t', 'v1=abc'],
      ['lixo', 'qualquer-coisa'],
      ['t não numérico', 't=ontem,v1=abc'],
    ])('recusa %s', (_caso, header) => {
      expect(verificarAssinatura(CORPO, header, SEGREDO).valida).toBe(false);
    });
  });
});
