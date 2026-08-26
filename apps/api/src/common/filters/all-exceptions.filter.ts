import { randomUUID } from 'node:crypto';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { DomainError, ProblemDetails, problemType } from '../errors/problem-details';

import type { Request, Response } from 'express';

/**
 * Filtro global: converte qualquer exceção no corpo RFC 7807 da API.
 *
 * Três princípios:
 *
 * 1. **Um contrato só.** O integrador trata uma forma de erro, não uma por rota.
 * 2. **Nada de detalhe interno em 5xx.** Stack trace e mensagem de driver vão
 *    para o log com o `requestId`; o cliente recebe uma mensagem genérica e esse
 *    id. Vazar estrutura interna em resposta de erro é entregar mapa a quem
 *    estiver sondando.
 * 3. **Mensagem em PT-BR e acionável** — quem lê precisa saber o que corrigir.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // O pino atribui o id no início da requisição, mas erros do body-parser
    // ocorrem antes disso. Gerar um aqui garante que toda resposta de erro
    // tenha um identificador rastreável.
    const requestId = (request.headers['x-request-id'] as string) ?? randomUUID();
    const problem = this.toProblem(exception, request.url, requestId);

    if (problem.status >= 500) {
      // 5xx é defeito nosso: o log precisa do máximo de contexto.
      this.logger.error(
        { err: exception, requestId, path: request.url, method: request.method },
        `Erro não tratado: ${problem.detail}`,
      );
    } else if (problem.status !== HttpStatus.NOT_FOUND) {
      this.logger.debug({ requestId, path: request.url, status: problem.status }, problem.detail);
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, instance: string, requestId: string): ProblemDetails {
    const base = { instance, requestId };

    // --- erros de domínio: já sabem o que são ---
    if (exception instanceof DomainError) {
      return {
        ...base,
        type: exception.type,
        title: exception.title,
        status: exception.status,
        detail: exception.message,
        ...(exception.meta ? { errors: undefined } : {}),
      };
    }

    // --- exceções do Nest, incluindo as do ValidationPipe ---
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null) {
        const body = payload as Record<string, unknown>;
        const rawMessage = body.message;

        // O ValidationPipe entrega um array de mensagens por campo.
        if (Array.isArray(rawMessage)) {
          return {
            ...base,
            type: problemType('validation-failed'),
            title: 'Dados inválidos',
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            detail: 'Um ou mais campos da requisição estão inválidos.',
            errors: groupValidationMessages(rawMessage as string[]),
          };
        }

        return {
          ...base,
          type: problemType(slugify(String(body.error ?? exception.name))),
          // O título sempre vem da nossa tabela em PT-BR: o `error` do Nest é
          // em inglês ("Not Found", "Unauthorized") e quebraria a convenção da
          // API na primeira exceção built-in que escapasse.
          title: httpTitle(status),
          status,
          detail: translateBuiltIn(String(rawMessage ?? ''), status),
        };
      }

      return {
        ...base,
        type: problemType(slugify(exception.name)),
        title: httpTitle(status),
        status,
        detail: translateBuiltIn(String(payload), status),
      };
    }

    // --- erros do Prisma traduzidos para semântica HTTP ---
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return { ...base, ...this.fromPrisma(exception) };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        ...base,
        type: problemType('invalid-query'),
        title: 'Consulta inválida',
        status: HttpStatus.BAD_REQUEST,
        detail: 'Os parâmetros da consulta são inválidos.',
      };
    }

    // --- erros do body-parser (corpo grande demais, JSON malformado) ---
    // Chegam como erro cru com `type` e `status`, não como HttpException. Sem
    // este tratamento viram 500 "erro interno", e quem enviou uma mídia acima do
    // limite fica sem saber o que aconteceu.
    const bodyParserProblem = this.fromBodyParser(exception);
    if (bodyParserProblem) {
      return { ...base, ...bodyParserProblem };
    }

    // --- desconhecido: nada do interior vaza ---
    return {
      ...base,
      type: problemType('internal-error'),
      title: 'Erro interno',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail:
        'Ocorreu um erro inesperado. Informe o requestId acima ao acionar o suporte — ' +
        'é por ele que localizamos o log correspondente.',
    };
  }

  private fromBodyParser(
    exception: unknown,
  ): Pick<ProblemDetails, 'type' | 'title' | 'status' | 'detail'> | null {
    if (typeof exception !== 'object' || exception === null) return null;

    const error = exception as { type?: string; status?: number; limit?: number };

    switch (error.type) {
      case 'entity.too.large':
        return {
          type: problemType('payload-too-large'),
          title: 'Conteúdo grande demais',
          status: HttpStatus.PAYLOAD_TOO_LARGE,
          detail: error.limit
            ? `O corpo da requisição excede o limite de ${formatBytes(error.limit)}.`
            : 'O corpo da requisição excede o limite permitido.',
        };
      case 'entity.parse.failed':
        return {
          type: problemType('malformed-json'),
          title: 'JSON inválido',
          status: HttpStatus.BAD_REQUEST,
          detail: 'O corpo da requisição não é um JSON válido.',
        };
      case 'encoding.unsupported':
        return {
          type: problemType('unsupported-encoding'),
          title: 'Codificação não suportada',
          status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          detail: 'A codificação do conteúdo enviado não é suportada.',
        };
      default:
        return null;
    }
  }

  private fromPrisma(
    error: Prisma.PrismaClientKnownRequestError,
  ): Pick<ProblemDetails, 'type' | 'title' | 'status' | 'detail'> {
    switch (error.code) {
      case 'P2002': {
        const alvo = (error.meta?.target as string[] | undefined)?.join(', ');
        return {
          type: problemType('duplicate-resource'),
          title: 'Registro duplicado',
          status: HttpStatus.CONFLICT,
          detail: alvo
            ? `Já existe um registro com o mesmo valor em: ${alvo}.`
            : 'Já existe um registro com esses dados.',
        };
      }
      case 'P2025':
        return {
          type: problemType('not-found'),
          title: 'Não encontrado',
          status: HttpStatus.NOT_FOUND,
          detail: 'O registro informado não existe.',
        };
      case 'P2003':
        return {
          type: problemType('invalid-reference'),
          title: 'Referência inválida',
          status: HttpStatus.CONFLICT,
          detail: 'A operação referencia um registro que não existe.',
        };
      default:
        return {
          type: problemType('database-error'),
          title: 'Erro de banco de dados',
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          detail: 'Não foi possível concluir a operação no banco de dados.',
        };
    }
  }
}

/**
 * Agrupa as mensagens do class-validator por campo.
 *
 * Elas chegam como frases soltas ("chatId precisa incluir o código do país"), e o
 * integrador se vira muito melhor com `{ chatId: [...] }` do que com uma lista
 * plana que ele teria que parsear.
 */
function groupValidationMessages(messages: string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};

  for (const message of messages) {
    const field = message.split(' ')[0] ?? '_';
    (grouped[field] ??= []).push(message);
  }

  return grouped;
}

/**
 * Traduz as mensagens que o próprio Nest gera em inglês.
 *
 * A mais comum é a de rota inexistente ("Cannot GET /x"), que todo integrador
 * encontra ao errar um caminho — é a primeira impressão da API, e deixá-la em
 * inglês contradiz o resto das mensagens.
 */
function translateBuiltIn(message: string, status: number): string {
  const rotaInexistente = /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (.+)$/.exec(message);
  if (rotaInexistente) {
    return `A rota ${rotaInexistente[1]} ${rotaInexistente[2]} não existe. Consulte a documentação em /docs.`;
  }

  // O V8 gera estas em inglês e o Nest as repassa cruas.
  if (/^(Unexpected .*JSON|Unterminated string in JSON|Expected .* in JSON)/i.test(message)) {
    return 'O corpo da requisição não é um JSON válido.';
  }

  const conhecidas: Record<string, string> = {
    Unauthorized: 'Credencial ausente ou inválida.',
    Forbidden: 'Sua credencial não tem permissão para esta operação.',
    'Not Found': 'Recurso não encontrado.',
    'Internal Server Error': 'Ocorreu um erro inesperado.',
    'Bad Request': 'A requisição está malformada.',
    'Payload Too Large': 'O conteúdo enviado excede o tamanho máximo permitido.',
    'Unsupported Media Type': 'O formato do conteúdo enviado não é suportado.',
    'ThrottlerException: Too Many Requests':
      'Limite de requisições excedido. Aguarde antes de tentar novamente.',
  };

  return conhecidas[message] ?? (message || httpTitle(status));
}

function slugify(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '');
}

function httpTitle(status: number): string {
  const titles: Record<number, string> = {
    400: 'Requisição inválida',
    401: 'Não autorizado',
    403: 'Acesso negado',
    404: 'Não encontrado',
    409: 'Conflito',
    413: 'Conteúdo grande demais',
    415: 'Formato não suportado',
    422: 'Dados inválidos',
    429: 'Muitas requisições',
    500: 'Erro interno',
    502: 'Erro no serviço externo',
    503: 'Serviço indisponível',
    504: 'Tempo esgotado',
  };
  return titles[status] ?? 'Erro';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
