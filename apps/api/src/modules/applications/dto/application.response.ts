import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiKeyResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'produção' }) name!: string;

  @ApiProperty({
    description: 'Parte pública da chave. O segredo não é recuperável.',
    example: 'wgw_live_a1b2c3d4e5f6',
  })
  prefix!: string;

  @ApiProperty({ type: [String], example: ['messages:send'] })
  scopes!: string[];

  @ApiPropertyOptional({ nullable: true }) lastUsedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) expiresAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) revokedAt!: Date | null;
  @ApiProperty() createdAt!: Date;

  @ApiProperty({ description: 'Falso se revogada, expirada ou com a aplicação desativada.' })
  active!: boolean;
}

export class CreatedApiKeyResponse extends ApiKeyResponse {
  @ApiProperty({
    description:
      'A chave completa. **Exibida uma única vez** — copie agora. ' +
      'Não é possível recuperá-la depois; se perder, revogue e emita outra.',
    example: 'wgw_live_a1b2c3d4e5f6_9fK2xQ7mNp4vR8sT1uW3yZ5aB6cD0eF',
  })
  secret!: string;

  @ApiProperty({ example: 'Guarde esta chave agora — ela não será exibida novamente.' })
  warning!: string;
}

export class ApplicationResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'CRM Vendas' }) name!: string;
  @ApiProperty({ example: 'crm-vendas' }) slug!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  @ApiPropertyOptional({ description: 'Contagens agregadas, quando solicitadas.' })
  counts?: {
    sessions: number;
    connectedSessions: number;
    activeApiKeys: number;
    messagesLast30Days: number;
  };
}

export class ApplicationDetailResponse extends ApplicationResponse {
  @ApiProperty({ type: [ApiKeyResponse] })
  apiKeys!: ApiKeyResponse[];
}
