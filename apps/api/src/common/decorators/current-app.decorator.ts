import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AuthenticatedApiKey } from '../../modules/api-keys/api-key.types';
import type { Request } from 'express';

/**
 * Injeta a aplicação dona da API key autenticada.
 *
 * É o parâmetro que sustenta o isolamento: toda consulta filtra por
 * `application.id`, e tê-lo como argumento explícito do handler torna difícil
 * escrever uma query que o esqueça.
 */
export const CurrentApplication = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedApiKey['application'] => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.apiKey) {
      throw new Error(
        'CurrentApplication usado em rota sem ApiKeyGuard — a identidade não foi resolvida.',
      );
    }
    return request.apiKey.application;
  },
);

/** Injeta a chave autenticada — usada para atribuição e auditoria. */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedApiKey => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.apiKey) {
      throw new Error('CurrentApiKey usado em rota sem ApiKeyGuard.');
    }
    return request.apiKey;
  },
);
