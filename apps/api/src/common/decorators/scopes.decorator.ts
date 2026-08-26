import { SetMetadata } from '@nestjs/common';

import type { ApiScope } from '@gateway/shared';

export const SCOPES_KEY = 'requiredScopes';

/** Exige que a API key tenha todos os escopos listados. */
export const Scopes = (...scopes: ApiScope[]) => SetMetadata(SCOPES_KEY, scopes);
