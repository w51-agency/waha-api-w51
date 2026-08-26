import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificação da assinatura HMAC dos webhooks do WAHA.
 *
 * O WAHA assina com **HMAC-SHA512 sobre o corpo bruto** e envia em
 * `X-Webhook-Hmac`, com `X-Webhook-Hmac-Algorithm`, `X-Webhook-Request-Id` e
 * `X-Webhook-Timestamp`.
 *
 * O detalhe que quebra implementações ingênuas: a assinatura cobre os **bytes
 * exatos recebidos**. Se o corpo for parseado e reserializado — mudando ordem de
 * chaves, espaçamento ou escape de unicode — o HMAC não bate. Por isso o
 * `rawBody: true` no bootstrap (tarefa 04).
 */

export interface VerificacaoAssinatura {
  valida: boolean;
  motivo?: string;
}

export function verificarAssinaturaWaha(
  rawBody: Buffer | undefined,
  assinatura: string | undefined,
  segredo: string,
  algoritmo = 'sha512',
): VerificacaoAssinatura {
  if (!rawBody || rawBody.length === 0) {
    return { valida: false, motivo: 'corpo vazio' };
  }
  if (!assinatura) {
    return { valida: false, motivo: 'header X-Webhook-Hmac ausente' };
  }
  if (algoritmo !== 'sha512' && algoritmo !== 'sha256') {
    return { valida: false, motivo: `algoritmo não suportado: ${algoritmo}` };
  }

  const esperada = createHmac(algoritmo, segredo).update(rawBody).digest('hex');

  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(assinatura.trim().toLowerCase(), 'utf8');

  // timingSafeEqual exige tamanhos iguais; comparar antes evita a exceção e já
  // decide o caso.
  if (a.length !== b.length) {
    return { valida: false, motivo: 'assinatura com tamanho inesperado' };
  }

  return timingSafeEqual(a, b)
    ? { valida: true }
    : { valida: false, motivo: 'assinatura não confere' };
}

/**
 * Janela de tolerância do timestamp, contra replay.
 *
 * Uma requisição capturada continua com assinatura válida para sempre; o que a
 * invalida é a idade. A janela precisa ser larga o bastante para acomodar as
 * retentativas do WAHA (que podem levar minutos) e estreita o bastante para que
 * um replay tardio não passe.
 */
export function timestampDentroDaJanela(
  header: string | undefined,
  toleranciaSegundos: number,
): VerificacaoAssinatura {
  if (!header) return { valida: true }; // o WAHA nem sempre envia

  const timestamp = Number(header);
  if (!Number.isFinite(timestamp)) {
    return { valida: false, motivo: 'timestamp inválido' };
  }

  // O header vem em milissegundos.
  const idadeSegundos = Math.abs(Date.now() - timestamp) / 1000;

  return idadeSegundos <= toleranciaSegundos
    ? { valida: true }
    : { valida: false, motivo: `evento com ${Math.round(idadeSegundos)}s de idade` };
}
