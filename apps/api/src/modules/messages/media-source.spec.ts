import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../common/errors/problem-details';

import { assertBase64DentroDoLimite, assertUrlDeMidiaSegura } from './media-source';

describe('assertUrlDeMidiaSegura', () => {
  describe('bloqueio de SSRF', () => {
    it.each([
      ['metadados de instância em nuvem', 'http://169.254.169.254/latest/meta-data/'],
      ['loopback', 'http://127.0.0.1:3000/interno'],
      ['loopback alternativo', 'http://127.1.2.3/x'],
      ['rede privada 10.x', 'http://10.0.0.5/segredo'],
      ['rede privada 192.168.x', 'http://192.168.1.1/config'],
      ['rede privada 172.16-31', 'http://172.20.0.3/x'],
      ['CGNAT', 'http://100.64.0.1/x'],
      ['rede atual 0.x', 'http://0.0.0.0/x'],
      ['IPv6 loopback', 'http://[::1]/x'],
      ['IPv6 unique local', 'http://[fd00::1]/x'],
      ['IPv6 link-local', 'http://[fe80::1]/x'],
    ])('recusa %s', async (_caso, url) => {
      await expect(assertUrlDeMidiaSegura(url)).rejects.toThrow(ValidationError);
    });

    it('a mensagem explica o motivo sem expor topologia', async () => {
      const erro = await assertUrlDeMidiaSegura('http://10.0.0.5/x').catch((e: unknown) => e);

      expect((erro as Error).message).toMatch(/endereço interno/);
    });
  });

  describe('protocolos', () => {
    it.each(['file:///etc/passwd', 'ftp://exemplo.com/a.jpg', 'gopher://x/1'])(
      'recusa %s',
      async (url) => {
        await expect(assertUrlDeMidiaSegura(url)).rejects.toThrow(/Protocolo/);
      },
    );

    it('recusa URL malformada', async () => {
      await expect(assertUrlDeMidiaSegura('isto não é uma url')).rejects.toThrow(ValidationError);
    });
  });

  describe('domínios', () => {
    it('recusa domínio que não resolve', async () => {
      await expect(
        assertUrlDeMidiaSegura('https://dominio-que-nao-existe-mesmo-12345.invalid/a.jpg'),
      ).rejects.toThrow(/resolver o domínio/);
    });

    it('recusa localhost — resolve para loopback', async () => {
      await expect(assertUrlDeMidiaSegura('http://localhost:8080/x')).rejects.toThrow(
        ValidationError,
      );
    });
  });
});

describe('assertBase64DentroDoLimite', () => {
  it('decodifica conteúdo válido', () => {
    const original = Buffer.from('conteúdo de teste');
    const decodificado = assertBase64DentroDoLimite(original.toString('base64'), 1024);

    expect(decodificado.toString()).toBe('conteúdo de teste');
  });

  it('aceita data URI, descartando o prefixo', () => {
    const dataUri = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;

    expect(assertBase64DentroDoLimite(dataUri, 1024).toString()).toBe('png');
  });

  it('recusa acima do limite, informando os tamanhos em MB', () => {
    const grande = Buffer.alloc(2 * 1024 * 1024).toString('base64');
    const erro = capturarSync(() => assertBase64DentroDoLimite(grande, 1024 * 1024));

    expect(erro.message).toMatch(/2\.0 MB/);
    expect(erro.message).toMatch(/1\.0 MB/);
  });

  it('recusa conteúdo vazio', () => {
    expect(() => assertBase64DentroDoLimite('', 1024)).toThrow(ValidationError);
  });
});

function capturarSync(fn: () => unknown): Error {
  try {
    fn();
    throw new Error('esperava uma exceção');
  } catch (e) {
    return e as Error;
  }
}
