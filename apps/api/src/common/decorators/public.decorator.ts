import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Dispensa a rota de autenticação.
 *
 * Usado por health checks, documentação e pelo endpoint interno de webhook do
 * WAHA — que não usa API key, mas sim verificação de assinatura HMAC própria.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const TOKEN_NA_QUERY_KEY = 'aceitaTokenNaQuery';

/**
 * Permite autenticar por `?token=` além do header.
 *
 * Necessário apenas onde o navegador **não consegue** enviar cabeçalhos: `<img
 * src>`, `<audio src>`, `window.open` para download. Token em query string
 * aparece em log de servidor e histórico do navegador, então é opt-in por rota,
 * nunca global — e só em rotas GET de leitura.
 */
export const AceitaTokenNaQuery = () => SetMetadata(TOKEN_NA_QUERY_KEY, true);
