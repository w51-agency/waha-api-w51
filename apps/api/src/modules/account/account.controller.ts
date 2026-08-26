import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { CurrentApiKey } from '../../common/decorators/current-app.decorator';
import { AuthenticatedApiKey } from '../api-keys/api-key.types';

import { AccountResponse } from './dto/account.response';

import { API_SCOPE_LABELS } from '@gateway/shared';

@ApiTags('Conta')
@ApiSecurity('ApiKeyAuth')
@Controller('v1/me')
export class AccountController {
  @Get()
  @ApiOperation({
    summary: 'Dados da aplicação autenticada',
    description:
      'Confirma que a sua chave está válida e mostra a qual aplicação ela pertence, ' +
      'junto dos escopos que ela concede. Use este endpoint para testar a integração ' +
      'antes de qualquer outra chamada.',
  })
  @ApiOkResponse({ type: AccountResponse })
  me(@CurrentApiKey() apiKey: AuthenticatedApiKey): AccountResponse {
    return {
      application: apiKey.application,
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
      },
      scopes: apiKey.scopes.map((scope) => ({
        scope,
        description: API_SCOPE_LABELS[scope],
      })),
    };
  }
}
