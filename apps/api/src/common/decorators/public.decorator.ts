import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Dispensa a rota de autenticação.
 *
 * Usado por health checks, documentação e pelo endpoint interno de webhook do
 * WAHA — que não usa API key, mas sim verificação de assinatura HMAC própria.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
