import type { ApiScope } from '@gateway/shared';

/** Identidade resolvida a partir de uma API key válida. */
export interface AuthenticatedApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  application: {
    id: string;
    name: string;
    slug: string;
  };
}

declare module 'express' {
  interface Request {
    apiKey?: AuthenticatedApiKey;
    admin?: { username: string };
    /**
     * Corpo bruto, preservado pelo `rawBody: true` do bootstrap.
     * Indispensável para verificar o HMAC dos webhooks do WAHA, que cobre os
     * bytes exatos recebidos.
     */
    rawBody?: Buffer;
  }
}
