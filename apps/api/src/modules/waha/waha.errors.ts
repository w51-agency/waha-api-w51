import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../common/errors/problem-details';

/**
 * Erros do WAHA traduzidos para o domínio do gateway.
 *
 * A tradução acontece em um lugar só (o WahaClient) para que o resto do código
 * lide com conceitos nossos — "sessão não existe", "serviço fora do ar" — sem
 * precisar conhecer códigos HTTP de um serviço externo.
 *
 * Todos carregam o corpo original em `cause`, que vai para o log mas nunca para
 * a resposta: detalhe interno do WAHA não é assunto do integrador.
 */
export class WahaError extends DomainError {
  constructor(
    slug: string,
    title: string,
    message: string,
    status: HttpStatus,
    readonly upstream?: unknown,
  ) {
    super(slug, title, message, status);
  }
}

export class WahaSessionNotFoundError extends WahaError {
  constructor(sessionName: string, upstream?: unknown) {
    super(
      'waha-session-not-found',
      'Sessão não encontrada',
      `A sessão "${sessionName}" não existe no serviço de WhatsApp.`,
      HttpStatus.NOT_FOUND,
      upstream,
    );
  }
}

export class WahaValidationError extends WahaError {
  constructor(message: string, upstream?: unknown) {
    super(
      'waha-validation-failed',
      'Requisição recusada',
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      upstream,
    );
  }
}

export class WahaAuthError extends WahaError {
  constructor(upstream?: unknown) {
    super(
      'waha-auth-failed',
      'Erro de configuração',
      'O gateway não conseguiu se autenticar no serviço de WhatsApp. ' +
        'Verifique a variável WAHA_API_KEY.',
      HttpStatus.INTERNAL_SERVER_ERROR,
      upstream,
    );
  }
}

export class WahaUnavailableError extends WahaError {
  constructor(detalhe?: string, upstream?: unknown) {
    super(
      'waha-unavailable',
      'Serviço indisponível',
      `O serviço de WhatsApp não respondeu${detalhe ? ` (${detalhe})` : ''}. Tente novamente em instantes.`,
      HttpStatus.SERVICE_UNAVAILABLE,
      upstream,
    );
  }
}

export class WahaSessionNotWorkingError extends WahaError {
  constructor(sessionName: string, status: string, upstream?: unknown) {
    super(
      'waha-session-not-working',
      'Sessão não conectada',
      `A sessão "${sessionName}" está com status ${status} e não pode enviar mensagens. ` +
        'Conecte o número escaneando o QR code.',
      HttpStatus.CONFLICT,
      upstream,
    );
  }
}
