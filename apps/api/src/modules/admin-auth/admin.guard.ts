import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { TOKEN_NA_QUERY_KEY } from '../../common/decorators/public.decorator';
import { UnauthorizedError } from '../../common/errors/problem-details';
import { AppConfig } from '../../config';

import type { Request } from 'express';

/**
 * Protege as rotas do painel.
 *
 * Aplicado por controller (`@UseGuards(AdminGuard)`), não globalmente: o guard
 * global é o de API key, e as duas autenticações são mutuamente exclusivas.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const token = this.extrairToken(request, context);

    if (!token) {
      throw new UnauthorizedError('Faça login para acessar o painel.', 'missing-token');
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: string }>(token, {
        secret: this.config.get('JWT_SECRET'),
      });

      request.admin = { username: payload.sub };
      return true;
    } catch (error) {
      // O tipo distingue "expirou" de "é inválido": o painel usa isso para
      // decidir entre renovar em silêncio e mandar o usuário refazer o login.
      const expirou = error instanceof Error && error.name === 'TokenExpiredError';
      throw new UnauthorizedError(
        expirou ? 'Sessão expirada.' : 'Token inválido.',
        expirou ? 'token-expired' : 'invalid-token',
      );
    }
  }

  /**
   * Extrai o token do header ou, em rotas marcadas, da query string.
   *
   * A query só é consultada onde o navegador não consegue enviar cabeçalhos —
   * `<img src>`, `<audio src>`, download por `window.open`. Aceitar em toda rota
   * espalharia o token pelo log de acesso do servidor e pelo histórico do
   * navegador.
   */
  private extrairToken(request: Request, context: ExecutionContext): string | null {
    const auth = request.headers.authorization;

    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim() || null;
    }

    const aceitaQuery = this.reflector.getAllAndOverride<boolean>(TOKEN_NA_QUERY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (aceitaQuery && request.method === 'GET') {
      const token = request.query.token;
      if (typeof token === 'string' && token) return token;
    }

    return null;
  }
}
