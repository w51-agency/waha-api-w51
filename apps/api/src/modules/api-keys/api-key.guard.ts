import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { SCOPES_KEY } from '../../common/decorators/scopes.decorator';
import { ForbiddenError, UnauthorizedError } from '../../common/errors/problem-details';

import { ApiKeyService } from './api-key.service';

import { API_SCOPE_LABELS, type ApiScope } from '@gateway/shared';
import type { Request } from 'express';

/**
 * Autentica requisições da API pública pela chave em `X-API-Key`.
 *
 * Aceita também `Authorization: Bearer <chave>`, porque muitos clientes HTTP e
 * geradores de SDK só sabem mandar credencial nesse header.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();

    // Rotas administrativas e internas têm autenticação própria (JWT do painel
    // e HMAC do WAHA, respectivamente). Este guard é global para que a API
    // pública seja protegida por padrão — esquecer um `@UseGuards` deixaria uma
    // rota aberta, e o erro só apareceria numa auditoria.
    if (isOutraAutenticacao(request.path)) return true;

    const plaintext = extractKey(request);

    if (!plaintext) {
      throw new UnauthorizedError(
        'Envie sua chave no header X-API-Key. Consulte a documentação em /docs.',
        'missing-api-key',
      );
    }

    const identity = await this.apiKeys.authenticate(plaintext);
    request.apiKey = identity;

    const required = this.reflector.getAllAndOverride<ApiScope[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required?.length) {
      const faltando = required.filter((scope) => !identity.scopes.includes(scope));
      if (faltando.length > 0) {
        // Nomear o escopo que falta é seguro — quem já autenticou conhece a
        // própria chave — e é o que permite corrigir sem abrir um chamado.
        const descricao = faltando.map((s) => `${s} (${API_SCOPE_LABELS[s]})`).join(', ');
        throw new ForbiddenError(
          `Esta chave não possui o escopo necessário: ${descricao}. ` +
            'Emita uma nova chave no painel com o escopo faltante.',
          'missing-scope',
        );
      }
    }

    return true;
  }
}

/** Prefixos que não usam API key. */
function isOutraAutenticacao(path: string): boolean {
  return path.startsWith('/admin') || path.startsWith('/internal');
}

function extractKey(request: Request): string | null {
  const header = request.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();

  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const value = auth.slice(7).trim();
    if (value) return value;
  }

  return null;
}
