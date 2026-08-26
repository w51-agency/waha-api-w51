import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { timestampDentroDaJanela, verificarAssinaturaWaha } from './webhook-signature';

const SEGREDO = 'segredo-de-teste-com-tamanho-suficiente';

function assinar(corpo: string, segredo = SEGREDO, algoritmo = 'sha512'): string {
  return createHmac(algoritmo, segredo).update(Buffer.from(corpo)).digest('hex');
}

describe('verificarAssinaturaWaha', () => {
  const corpo = JSON.stringify({ id: 'evt_1', event: 'message', payload: { texto: 'olá' } });
  const buffer = Buffer.from(corpo);

  it('aceita assinatura correta', () => {
    expect(verificarAssinaturaWaha(buffer, assinar(corpo), SEGREDO).valida).toBe(true);
  });

  it('aceita assinatura em maiúsculas — normalizamos antes de comparar', () => {
    const r = verificarAssinaturaWaha(buffer, assinar(corpo).toUpperCase(), SEGREDO);

    expect(r.valida).toBe(true);
  });

  it('recusa corpo alterado em um único byte', () => {
    const alterado = Buffer.from(corpo.replace('olá', 'olà'));

    expect(verificarAssinaturaWaha(alterado, assinar(corpo), SEGREDO).valida).toBe(false);
  });

  it('recusa quando o segredo é outro', () => {
    expect(verificarAssinaturaWaha(buffer, assinar(corpo, 'outro-segredo'), SEGREDO).valida).toBe(
      false,
    );
  });

  it('recusa corpo reserializado — a assinatura cobre os bytes exatos', () => {
    // Mesmo objeto, ordem de chaves diferente: é exatamente o que aconteceria
    // se lêssemos req.body em vez de req.rawBody.
    const reserializado = Buffer.from(
      JSON.stringify({ event: 'message', id: 'evt_1', payload: { texto: 'olá' } }),
    );

    expect(verificarAssinaturaWaha(reserializado, assinar(corpo), SEGREDO).valida).toBe(false);
  });

  it.each([
    ['assinatura ausente', undefined],
    ['assinatura vazia', ''],
    ['assinatura truncada', 'abc123'],
  ])('recusa %s', (_caso, assinatura) => {
    const r = verificarAssinaturaWaha(buffer, assinatura, SEGREDO);

    expect(r.valida).toBe(false);
    expect(r.motivo).toBeDefined();
  });

  it('recusa corpo vazio', () => {
    expect(verificarAssinaturaWaha(Buffer.alloc(0), assinar(''), SEGREDO).valida).toBe(false);
    expect(verificarAssinaturaWaha(undefined, assinar(''), SEGREDO).valida).toBe(false);
  });

  it('aceita sha256 quando o WAHA anuncia esse algoritmo', () => {
    const r = verificarAssinaturaWaha(buffer, assinar(corpo, SEGREDO, 'sha256'), SEGREDO, 'sha256');

    expect(r.valida).toBe(true);
  });

  it('recusa algoritmo não suportado em vez de tentar adivinhar', () => {
    const r = verificarAssinaturaWaha(buffer, assinar(corpo), SEGREDO, 'md5');

    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/algoritmo/);
  });
});

describe('timestampDentroDaJanela', () => {
  it('aceita evento recente', () => {
    expect(timestampDentroDaJanela(String(Date.now()), 300).valida).toBe(true);
  });

  it('recusa evento antigo — é assim que um replay é barrado', () => {
    const umaHoraAtras = String(Date.now() - 3_600_000);
    const r = timestampDentroDaJanela(umaHoraAtras, 300);

    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/idade/);
  });

  it('recusa timestamp muito no futuro — relógio adiantado ou forjado', () => {
    expect(timestampDentroDaJanela(String(Date.now() + 3_600_000), 300).valida).toBe(false);
  });

  it('aceita quando o header está ausente — o WAHA nem sempre o envia', () => {
    expect(timestampDentroDaJanela(undefined, 300).valida).toBe(true);
  });

  it('recusa timestamp não numérico', () => {
    expect(timestampDentroDaJanela('ontem', 300).valida).toBe(false);
  });
});
