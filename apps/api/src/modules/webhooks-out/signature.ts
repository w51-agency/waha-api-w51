import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura dos webhooks que enviamos aos integradores.
 *
 * Formato (estilo Stripe):  `X-Gateway-Signature: t=1740000000,v1=<hmac-hex>`
 *
 * O HMAC-SHA256 cobre `"{timestamp}.{corpo}"`, **não apenas o corpo**. Essa é a
 * parte que costuma ser omitida e que importa: assinando só o corpo, uma
 * requisição capturada permanece válida para sempre e pode ser reenviada
 * indefinidamente. Com o timestamp dentro do que é assinado, o receptor pode
 * recusar entregas antigas sem que o atacante consiga forjar um timestamp novo.
 */

export interface AssinaturaGerada {
  header: string;
  timestamp: number;
  assinatura: string;
}

export function assinarPayload(
  corpo: string,
  segredo: string,
  agora = Date.now(),
): AssinaturaGerada {
  const timestamp = Math.floor(agora / 1000);
  const assinatura = createHmac('sha256', segredo).update(`${timestamp}.${corpo}`).digest('hex');

  return { header: `t=${timestamp},v1=${assinatura}`, timestamp, assinatura };
}

/**
 * Verificação — a mesma que publicamos na documentação para o integrador.
 *
 * Mantida aqui para que os testes provem que o snippet publicado funciona
 * contra o que realmente enviamos.
 */
export function verificarAssinatura(
  corpo: string,
  header: string,
  segredo: string,
  toleranciaSegundos = 300,
  agora = Date.now(),
): { valida: boolean; motivo?: string } {
  const partes = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...resto] = p.trim().split('=');
      return [k ?? '', resto.join('=')];
    }),
  );

  const timestamp = Number(partes.t);
  const recebida = partes.v1;

  if (!Number.isFinite(timestamp) || !recebida) {
    return { valida: false, motivo: 'header malformado' };
  }

  const idade = Math.abs(Math.floor(agora / 1000) - timestamp);
  if (idade > toleranciaSegundos) {
    return { valida: false, motivo: `entrega com ${idade}s de idade` };
  }

  const esperada = createHmac('sha256', segredo).update(`${timestamp}.${corpo}`).digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(recebida);

  if (a.length !== b.length) return { valida: false, motivo: 'assinatura com tamanho inesperado' };

  return timingSafeEqual(a, b)
    ? { valida: true }
    : { valida: false, motivo: 'assinatura não confere' };
}
