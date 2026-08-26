import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { GATEWAY_EVENTS } from '../events';

const EVENTOS_ACEITOS = [...GATEWAY_EVENTS, '*'];

export class CreateWebhookDto {
  @ApiProperty({
    description:
      'URL do seu sistema que receberá os eventos. Deve responder 2xx rapidamente — ' +
      'processe de forma assíncrona do seu lado.',
    example: 'https://seu-sistema.com/webhooks/whatsapp',
  })
  @IsString({ message: 'url é obrigatória.' })
  @MinLength(8)
  @MaxLength(2000)
  url!: string;

  @ApiPropertyOptional({
    description: 'Eventos que deseja receber. Use ["*"] para todos.',
    default: ['*'],
    example: ['message.received', 'session.connected'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(EVENTOS_ACEITOS, {
    each: true,
    message: `Evento inválido. Válidos: ${EVENTOS_ACEITOS.join(', ')}.`,
  })
  events?: string[];

  @ApiPropertyOptional({ example: 'Integração com o CRM' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsIn(EVENTOS_ACEITOS, { each: true })
  events?: string[];

  @ApiPropertyOptional({ description: 'Reativar um endpoint desligado automaticamente.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class WebhookResponse {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ type: [String] }) events!: string[];
  @ApiProperty() active!: boolean;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;

  @ApiProperty({ description: 'Falhas consecutivas. Zera a cada entrega bem-sucedida.' })
  consecutiveFailures!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Preenchido quando o endpoint foi desligado por falhas seguidas.',
  })
  disabledAt!: Date | null;

  @ApiPropertyOptional({ nullable: true }) disabledReason!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class CreatedWebhookResponse extends WebhookResponse {
  @ApiProperty({
    description: 'Segredo para verificar a assinatura das entregas. **Exibido uma única vez.**',
  })
  secret!: string;

  @ApiProperty() warning!: string;
}

export class DeliveryResponse {
  @ApiProperty() id!: string;
  @ApiProperty() eventType!: string;
  @ApiProperty() status!: string;
  @ApiProperty() attempts!: number;
  @ApiPropertyOptional({ nullable: true }) responseStatus!: number | null;
  @ApiPropertyOptional({ nullable: true }) responseBody!: string | null;
  @ApiPropertyOptional({ nullable: true }) error!: string | null;
  @ApiPropertyOptional({ nullable: true }) durationMs!: number | null;
  @ApiPropertyOptional({ nullable: true }) nextRetryAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) deliveredAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}
