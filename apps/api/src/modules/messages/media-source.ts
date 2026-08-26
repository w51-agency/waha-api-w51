import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { ValidationError } from '../../common/errors/problem-details';

/**
 * Validação da origem de mídia informada por URL.
 *
 * Sem isto, um integrador poderia apontar `file.url` para `169.254.169.254`
 * (metadados de instância em nuvem), `localhost` ou um endereço da rede interna
 * — e o WAHA, que roda dentro da nossa rede, buscaria o recurso e o devolveria.
 * É SSRF clássico, e a superfície aqui é grande porque a URL vem de fora.
 *
 * A checagem resolve o DNS antes de aprovar: validar só o texto da URL deixaria
 * passar um domínio que aponta para IP privado.
 */

/** Faixas privadas, de loopback e link-local — IPv4 e IPv6. */
function isEnderecoInterno(ip: string): boolean {
  if (isIP(ip) === 6) {
    const normalizado = ip.toLowerCase();
    return (
      normalizado === '::1' ||
      normalizado === '::' ||
      normalizado.startsWith('fc') || // unique local
      normalizado.startsWith('fd') ||
      normalizado.startsWith('fe80') || // link-local
      normalizado.startsWith('::ffff:') // IPv4 mapeado
    );
  }

  const partes = ip.split('.').map(Number);
  if (partes.length !== 4 || partes.some((p) => !Number.isInteger(p))) return true;

  const [a, b] = partes as [number, number, number, number];

  return (
    a === 0 || // rede atual
    a === 10 || // privada
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, inclui metadados de nuvem
    (a === 172 && b >= 16 && b <= 31) || // privada
    (a === 192 && b === 168) || // privada
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224 // multicast e reservado
  );
}

export interface OpcoesValidacaoUrl {
  /**
   * Permite endereços privados e loopback.
   *
   * Existe **apenas** para desenvolvimento de webhooks, onde o receptor de teste
   * roda em `localhost`. Nunca deve ser ligado para mídia: aquela URL é buscada
   * pelo WAHA, que roda dentro da nossa rede, e liberar endereços internos ali
   * seria SSRF direto. Controlado por `ALLOW_INSECURE_WEBHOOKS`.
   */
  permitirEnderecoInterno?: boolean;
}

export async function assertUrlDeMidiaSegura(
  url: string,
  opcoes: OpcoesValidacaoUrl = {},
): Promise<URL> {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`"${url}" não é uma URL válida.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(
      `Protocolo "${parsed.protocol}" não é aceito. Use http:// ou https://.`,
    );
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  if (opcoes.permitirEnderecoInterno) return parsed;

  // Host que já é um IP: decide direto.
  if (isIP(host)) {
    if (isEnderecoInterno(host)) {
      throw new ValidationError(
        `A URL aponta para um endereço interno (${host}), que não é acessível por segurança.`,
      );
    }
    return parsed;
  }

  // Domínio: resolve antes de aprovar. Um nome pode apontar para IP privado.
  let enderecos;
  try {
    enderecos = await lookup(host, { all: true });
  } catch {
    throw new ValidationError(`Não foi possível resolver o domínio "${host}".`);
  }

  const interno = enderecos.find((e) => isEnderecoInterno(e.address));
  if (interno) {
    throw new ValidationError(
      `O domínio "${host}" resolve para um endereço interno (${interno.address}), ` +
        'que não é acessível por segurança.',
    );
  }

  return parsed;
}

/** Valida o base64 e confere o tamanho decodificado contra o limite. */
export function assertBase64DentroDoLimite(data: string, limiteBytes: number): Buffer {
  const limpo = data.includes(',') ? (data.split(',')[1] ?? '') : data;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(limpo, 'base64');
  } catch {
    throw new ValidationError('O conteúdo em base64 é inválido.');
  }

  if (buffer.length === 0) {
    throw new ValidationError('O conteúdo em base64 está vazio.');
  }

  if (buffer.length > limiteBytes) {
    throw new ValidationError(
      `O arquivo tem ${formatarMb(buffer.length)}, acima do limite de ${formatarMb(limiteBytes)}.`,
    );
  }

  return buffer;
}

function formatarMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
