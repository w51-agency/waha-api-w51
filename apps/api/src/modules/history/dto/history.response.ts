import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Direction, MessageStatus } from '@gateway/shared';

export class MessageResponse {
  @ApiProperty() id!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Id da mensagem no WhatsApp.' })
  wahaId!: string | null;

  @ApiProperty() sessionId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Apelido da sessão.' })
  sessionLabel!: string | null;

  @ApiProperty({ enum: Direction })
  direction!: Direction;

  @ApiProperty({ example: '5511999999999@c.us' })
  chatId!: string;

  @ApiProperty({ example: '5511999999999', description: 'O número, sem o sufixo do WhatsApp.' })
  phone!: string;

  @ApiProperty({ example: 'text' })
  type!: string;

  @ApiPropertyOptional({ nullable: true })
  body!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'URL para baixar a mídia por este gateway. Requer a sua API key — ' +
      'o serviço de WhatsApp nunca é exposto diretamente.',
    example: '/v1/media/clx1a2b3c4d5',
  })
  mediaUrl!: string | null;

  @ApiPropertyOptional({ nullable: true }) mediaMimeType!: string | null;
  @ApiPropertyOptional({ nullable: true }) mediaSize!: number | null;

  @ApiProperty({ enum: MessageStatus })
  status!: MessageStatus;

  @ApiPropertyOptional({ nullable: true, description: 'Confirmação do WhatsApp.' })
  ack!: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Motivo, quando falhou.' })
  error!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Chave que enviou (só para enviadas).' })
  sentByApiKeyId!: string | null;

  @ApiProperty() timestamp!: Date;

  @ApiPropertyOptional({ description: 'Payload cru, apenas quando `includeRaw=true`.' })
  raw?: unknown;
}

export class PaginatedMessages {
  @ApiProperty({ type: [MessageResponse] })
  data!: MessageResponse[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Passe em `?cursor=` para a próxima página. Nulo na última.',
  })
  nextCursor!: string | null;

  @ApiProperty({ description: 'Se há mais registros além desta página.' })
  hasMore!: boolean;
}

export class ChatResponse {
  @ApiProperty({ example: '5511999999999@c.us' })
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  name!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Última atividade na conversa.' })
  lastMessageAt!: Date | null;

  @ApiPropertyOptional({ description: 'Mensagens não lidas.' })
  unreadCount?: number;
}

export class NumberCheckResponse {
  @ApiProperty({ description: 'Se o número possui WhatsApp.' })
  exists!: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'chatId para enviar mensagens.' })
  chatId!: string | null;
}
