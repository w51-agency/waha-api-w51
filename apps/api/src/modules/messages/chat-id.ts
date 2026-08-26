import { ValidationError } from '../../common/errors/problem-details';

/**
 * Normalização de destinatário.
 *
 * O integrador pode mandar `"5511999999999"`, `"+55 (11) 99999-9999"` ou o
 * `chatId` completo. Aceitar as três formas evita que cada sistema precise
 * conhecer o formato interno do WhatsApp — e evita o erro mais comum de
 * integração, que é mandar o número cru e receber uma falha obscura.
 *
 * Sufixos do WhatsApp:
 *   @c.us        conversa individual
 *   @g.us        grupo
 *   @newsletter  canal
 *   @lid         identificador oculto (privacidade)
 */

const SUFIXOS_VALIDOS = ['@c.us', '@g.us', '@newsletter', '@lid', '@broadcast'];

/**
 * Números brasileiros têm 10 ou 11 dígitos após o DDI 55. Menos que isso
 * costuma ser um número sem DDI, que o WhatsApp interpretaria como outro país.
 */
const MIN_DIGITOS = 10;
const MAX_DIGITOS = 15;

export function normalizeChatId(entrada: string): string {
  const valor = entrada.trim();

  if (!valor) {
    throw new ValidationError('Informe o destinatário em "to" ou "chatId".');
  }

  // Já veio no formato do WhatsApp.
  if (valor.includes('@')) {
    const sufixo = SUFIXOS_VALIDOS.find((s) => valor.endsWith(s));

    if (!sufixo) {
      throw new ValidationError(
        `Sufixo de chatId não reconhecido em "${valor}". ` +
          `Use um destes: ${SUFIXOS_VALIDOS.join(', ')} — ou informe apenas o número.`,
      );
    }

    const parte = valor.slice(0, -sufixo.length);
    if (!/^\d+$/.test(parte)) {
      throw new ValidationError(`A parte numérica de "${valor}" contém caracteres inválidos.`);
    }

    return valor;
  }

  const digitos = valor.replace(/\D/g, '');

  if (digitos.length < MIN_DIGITOS) {
    throw new ValidationError(
      `"${entrada}" tem apenas ${digitos.length} dígitos. ` +
        'Informe o número completo com o código do país — para o Brasil, ' +
        'algo como 5511999999999.',
    );
  }

  if (digitos.length > MAX_DIGITOS) {
    throw new ValidationError(
      `"${entrada}" tem ${digitos.length} dígitos, acima do máximo de ${MAX_DIGITOS}.`,
    );
  }

  return `${digitos}@c.us`;
}

/** Extrai o número puro de um chatId, para exibição. */
export function phoneFromChatId(chatId: string): string {
  return chatId.split('@')[0] ?? chatId;
}
