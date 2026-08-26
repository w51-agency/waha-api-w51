import { HttpStatus } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Corpo de erro no formato RFC 7807 (`application/problem+json`).
 *
 * A API inteira devolve erro nesta forma — um contrato só para o integrador
 * tratar, em vez de cada rota inventar o seu. O `type` é um identificador
 * estável e legível por máquina; o `detail` é a mensagem em PT-BR para humanos.
 */
export class ProblemDetails {
  @ApiProperty({
    description: 'Identificador estável do tipo de erro, no padrão recurso/motivo.',
    example: 'https://gateway.w51/errors/session-not-found',
  })
  type!: string;

  @ApiProperty({ description: 'Resumo curto do erro.', example: 'Sessão não encontrada' })
  title!: string;

  @ApiProperty({ description: 'Código HTTP.', example: 404 })
  status!: number;

  @ApiProperty({
    description: 'Explicação em português, voltada a quem vai corrigir o problema.',
    example: 'Nenhuma sessão com o id informado pertence à sua aplicação.',
  })
  detail!: string;

  @ApiProperty({ description: 'Caminho que originou o erro.', example: '/v1/sessions/abc123' })
  instance!: string;

  @ApiProperty({
    description: 'Id da requisição — informe-o ao pedir suporte, é por ele que achamos o log.',
    example: '01JCQ8Z5X9K2M4N6P8R0T2V4W6',
  })
  requestId!: string;

  @ApiProperty({
    description: 'Erros de validação por campo, quando houver.',
    required: false,
    example: { chatId: ['Número precisa incluir o código do país.'] },
  })
  errors?: Record<string, string[]>;
}

const BASE = 'https://gateway.w51/errors';

/** Monta o `type` a partir de um slug. */
export const problemType = (slug: string): string => `${BASE}/${slug}`;

/**
 * Erro de domínio do gateway.
 *
 * Existe para que a camada de serviço lance algo semanticamente rico
 * (`SessionNotWorkingError`) e o filtro global saiba traduzir para HTTP — sem
 * que cada serviço precise conhecer códigos de status.
 */
export class DomainError extends Error {
  constructor(
    readonly slug: string,
    readonly title: string,
    message: string,
    readonly status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }

  get type(): string {
    return problemType(this.slug);
  }
}

// --- erros de domínio usados em mais de um módulo ---

export class NotFoundError extends DomainError {
  constructor(message = 'Recurso não encontrado.', slug = 'not-found') {
    super(slug, 'Não encontrado', message, HttpStatus.NOT_FOUND);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, slug = 'conflict', meta?: Record<string, unknown>) {
    super(slug, 'Conflito', message, HttpStatus.CONFLICT, meta);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Credencial inválida.', slug = 'unauthorized') {
    super(slug, 'Não autorizado', message, HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenError extends DomainError {
  constructor(
    message = 'Sua credencial não tem permissão para esta operação.',
    slug = 'forbidden',
  ) {
    super(slug, 'Acesso negado', message, HttpStatus.FORBIDDEN);
  }
}

export class ValidationError extends DomainError {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super('validation-failed', 'Dados inválidos', message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class UpstreamUnavailableError extends DomainError {
  constructor(
    message = 'O serviço de WhatsApp está indisponível no momento.',
    slug = 'upstream-unavailable',
  ) {
    super(slug, 'Serviço indisponível', message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
