import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.headers.authorization;

    if (typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedError('Faça login para acessar o painel.', 'missing-token');
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: string }>(auth.slice(7), {
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
}
