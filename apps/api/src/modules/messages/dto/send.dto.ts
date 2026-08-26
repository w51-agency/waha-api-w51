import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Campos comuns a todo envio. */
export abstract class BaseSendDto {
  @ApiProperty({ description: 'Id da sessão que enviará a mensagem.' })
  @IsString({ message: 'sessionId é obrigatório.' })
  @MinLength(1, { message: 'sessionId é obrigatório.' })
  sessionId!: string;

  @ApiPropertyOptional({
    description:
      'Destinatário. Aceita o número com código do país (`5511999999999`), ' +
      'formatado (`+55 11 99999-9999`) ou o chatId completo (`...@c.us`, `...@g.us`). ' +
      'Use `to` **ou** `chatId` — são equivalentes.',
    example: '5511999999999',
  })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Alternativa a `to`.', example: '5511999999999@c.us' })
  @IsOptional()
  @IsString()
  chatId?: string;

  @ApiPropertyOptional({ description: 'Id da mensagem que está sendo respondida.' })
  @IsOptional()
  @IsString()
  replyTo?: string;
}

export class SendTextDto extends BaseSendDto {
  @ApiProperty({ example: 'Olá! Seu pedido foi confirmado.' })
  @IsString({ message: 'text precisa ser um texto.' })
  @MinLength(1, { message: 'text não pode ser vazio.' })
  @MaxLength(65536, { message: 'text excede o tamanho máximo aceito pelo WhatsApp.' })
  text!: string;

  @ApiPropertyOptional({ description: 'Gerar prévia do primeiro link. Padrão: true.' })
  @IsOptional()
  @IsBoolean()
  linkPreview?: boolean;

  @ApiPropertyOptional({
    description: 'Menções, em chatId. Em grupos, notifica os participantes citados.',
    type: [String],
    example: ['5511999999999@c.us'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];
}

/**
 * Envio de mídia.
 *
 * O arquivo pode vir de três formas: `url` (o WhatsApp baixa), `base64` (o
 * conteúdo vai no corpo) ou upload multipart. Exatamente uma delas.
 */
export class SendMediaDto extends BaseSendDto {
  @ApiPropertyOptional({
    description: 'URL pública do arquivo. Endereços internos são recusados por segurança.',
    example: 'https://exemplo.com/imagem.jpg',
  })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ description: 'Conteúdo do arquivo em base64.' })
  @IsOptional()
  @IsString()
  base64?: string;

  @ApiPropertyOptional({ description: 'Obrigatório quando usar `base64`.', example: 'image/jpeg' })
  @ValidateIf((o: SendMediaDto) => Boolean(o.base64))
  @IsString({ message: 'mimetype é obrigatório quando o arquivo vem em base64.' })
  mimetype?: string;

  @ApiPropertyOptional({ example: 'comprovante.pdf' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;

  @ApiPropertyOptional({ description: 'Legenda (imagem, vídeo e documento).' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  caption?: string;

  @ApiPropertyOptional({
    description:
      'Converter o arquivo para o formato que o WhatsApp aceita. ' +
      'Útil para áudio e vídeo fora do padrão.',
  })
  @IsOptional()
  @IsBoolean()
  convert?: boolean;

  @ApiPropertyOptional({ description: 'Enviar vídeo como nota (círculo).' })
  @IsOptional()
  @IsBoolean()
  asNote?: boolean;
}

export class SendLocationDto extends BaseSendDto {
  @ApiProperty({ example: -23.5505 })
  @IsLatitude({ message: 'latitude inválida.' })
  latitude!: number;

  @ApiProperty({ example: -46.6333 })
  @IsLongitude({ message: 'longitude inválida.' })
  longitude!: number;

  @ApiPropertyOptional({ example: 'Escritório' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class SendContactDto extends BaseSendDto {
  @ApiProperty({ example: 'Maria Silva' })
  @IsString({ message: 'fullName é obrigatório.' })
  @MinLength(1)
  fullName!: string;

  @ApiProperty({ example: '5511988887777' })
  @IsString({ message: 'phoneNumber é obrigatório.' })
  @MinLength(8)
  phoneNumber!: string;
}

export class SendReactionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  sessionId!: string;

  @ApiProperty({ description: 'Id da mensagem a reagir.' })
  @IsString()
  @MinLength(1)
  messageId!: string;

  @ApiProperty({ description: 'Emoji da reação. String vazia remove.', example: '👍' })
  @IsString()
  @MaxLength(8)
  emoji!: string;
}

export class SendSeenDto extends BaseSendDto {
  @ApiPropertyOptional({ type: [String], description: 'Mensagens a marcar como lidas.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  messageIds?: string[];
}

export class TypingDto extends BaseSendDto {
  @ApiProperty({ enum: ['start', 'stop'], example: 'start' })
  @IsString()
  action!: 'start' | 'stop';
}

export class SendResultDto {
  @ApiProperty({ description: 'Id da mensagem no gateway. Use-o para consultar o status.' })
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Id da mensagem no WhatsApp.' })
  wahaId!: string | null;

  @ApiProperty({ example: 'SENT' })
  status!: string;

  @ApiProperty({ example: '5511999999999@c.us' })
  chatId!: string;

  @ApiProperty() timestamp!: Date;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Motivo, quando o envio falha.',
  })
  error!: string | null;
}

/** Marcador de campo numérico usado por DTOs derivados. */
export abstract class NumericField {
  @IsNumber()
  value!: number;
}
