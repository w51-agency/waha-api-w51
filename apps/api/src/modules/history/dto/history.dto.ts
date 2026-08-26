import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { Direction, MessageStatus } from '@gateway/shared';

export class ListMessagesQuery {
  @ApiPropertyOptional({ description: 'Filtrar por sessão.' })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por conversa.', example: '5511999999999@c.us' })
  @IsOptional()
  @IsString()
  chatId?: string;

  @ApiPropertyOptional({
    enum: Direction,
    description: 'INBOUND = recebidas, OUTBOUND = enviadas.',
  })
  @IsOptional()
  @IsEnum(Direction, { message: 'direction precisa ser INBOUND ou OUTBOUND.' })
  direction?: Direction;

  @ApiPropertyOptional({ enum: MessageStatus })
  @IsOptional()
  @IsEnum(MessageStatus, { message: 'status inválido.' })
  status?: MessageStatus;

  @ApiPropertyOptional({ example: 'text', description: 'text, image, video, audio, document…' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  type?: string;

  @ApiPropertyOptional({ description: 'Início do período (ISO 8601).' })
  @IsOptional()
  @IsDateString({}, { message: 'from precisa ser uma data ISO 8601.' })
  from?: string;

  @ApiPropertyOptional({ description: 'Fim do período (ISO 8601).' })
  @IsOptional()
  @IsDateString({}, { message: 'to precisa ser uma data ISO 8601.' })
  to?: string;

  @ApiPropertyOptional({ description: 'Busca no conteúdo da mensagem.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit precisa ser um número inteiro.' })
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ description: 'O `nextCursor` da página anterior.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class MessageDetailQuery {
  @ApiPropertyOptional({
    description: 'Incluir o payload cru do serviço de WhatsApp — útil para depuração.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeRaw?: boolean;
}

export class ListChatsQuery {
  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class CheckNumberQuery {
  @ApiPropertyOptional({ example: '5511999999999' })
  @IsString({ message: 'phone é obrigatório.' })
  phone!: string;
}
