import { ValidationError } from '../../common/errors/problem-details';

/**
 * Paginação por cursor.
 *
 * `OFFSET` seria mais simples, mas erra em tabela que cresce durante a
 * navegação — e mensagens chegam o tempo todo. Com offset, uma mensagem nova
 * empurra as demais e a página seguinte repete registros já vistos; e o custo
 * cresce linearmente com a profundidade.
 *
 * O cursor codifica `(timestamp, id)`. O `id` desempata quando duas mensagens
 * têm o mesmo timestamp — sem ele, registros simultâneos seriam pulados na
 * virada de página.
 *
 * É opaco (base64url) de propósito: o formato é detalhe de implementação, e
 * clientes que o interpretassem travariam qualquer mudança futura.
 */

export interface Cursor {
  timestamp: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  const payload = `${cursor.timestamp.toISOString()}|${cursor.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(valor: string): Cursor {
  let texto: string;

  try {
    texto = Buffer.from(valor, 'base64url').toString('utf8');
  } catch {
    throw new ValidationError('O cursor informado é inválido.');
  }

  // Divide no PRIMEIRO separador, não no último: o timestamp ISO nunca contém
  // "|", mas um id pode conter — e dividir pelo último truncaria o timestamp.
  const separador = texto.indexOf('|');
  if (separador <= 0) {
    throw new ValidationError('O cursor informado é inválido.');
  }

  const timestamp = new Date(texto.slice(0, separador));
  const id = texto.slice(separador + 1);

  if (Number.isNaN(timestamp.getTime()) || !id) {
    throw new ValidationError('O cursor informado é inválido.');
  }

  return { timestamp, id };
}

/**
 * Condição de continuação para ordenação decrescente por `(timestamp, id)`.
 *
 * Traduz "tudo que vem depois deste ponto" em SQL: timestamp menor, **ou** o
 * mesmo timestamp com id menor.
 */
export function cursorWhere(cursor: Cursor) {
  return {
    OR: [
      { timestamp: { lt: cursor.timestamp } },
      { timestamp: cursor.timestamp, id: { lt: cursor.id } },
    ],
  };
}
