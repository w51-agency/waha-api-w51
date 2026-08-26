import { ApiProperty } from '@nestjs/swagger';

import type { ApiScope } from '@gateway/shared';

class ApplicationSummary {
  @ApiProperty({ example: 'clx1a2b3c4d5e6f7g8h9' })
  id!: string;

  @ApiProperty({ example: 'CRM Vendas' })
  name!: string;

  @ApiProperty({
    description: 'Identificador curto da aplicação. Compõe o nome interno das suas sessões.',
    example: 'crm-vendas',
  })
  slug!: string;
}

class ApiKeySummary {
  @ApiProperty({ example: 'clx9h8g7f6e5d4c3b2a1' })
  id!: string;

  @ApiProperty({ example: 'produção' })
  name!: string;

  @ApiProperty({
    description: 'Parte pública da chave. O segredo não é recuperável.',
    example: 'wgw_live_a1b2c3d4e5f6',
  })
  prefix!: string;
}

class ScopeInfo {
  @ApiProperty({ example: 'messages:send' })
  scope!: ApiScope;

  @ApiProperty({ example: 'Enviar mensagens' })
  description!: string;
}

export class AccountResponse {
  @ApiProperty({ type: ApplicationSummary })
  application!: ApplicationSummary;

  @ApiProperty({ type: ApiKeySummary })
  apiKey!: ApiKeySummary;

  @ApiProperty({ type: [ScopeInfo], description: 'O que esta chave pode fazer.' })
  scopes!: ScopeInfo[];
}
