import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { API_SCOPES } from '@gateway/shared';

export class CreateApplicationDto {
  @ApiProperty({ example: 'CRM Vendas', description: 'Nome do sistema integrador.' })
  @IsString({ message: 'name precisa ser um texto.' })
  @MinLength(2, { message: 'name precisa ter ao menos 2 caracteres.' })
  @MaxLength(120, { message: 'name pode ter no máximo 120 caracteres.' })
  name!: string;

  @ApiPropertyOptional({
    example: 'crm-vendas',
    description:
      'Identificador curto. Derivado do nome se omitido. **Imutável após a criação** — ' +
      'ele compõe o nome interno das sessões no serviço de WhatsApp.',
  })
  @IsOptional()
  @IsString({ message: 'slug precisa ser um texto.' })
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug pode conter apenas letras minúsculas, números e hífens.',
  })
  @MaxLength(60, { message: 'slug pode ter no máximo 60 caracteres.' })
  slug?: string;

  @ApiPropertyOptional({ example: 'Sistema comercial da equipe interna.' })
  @IsOptional()
  @IsString({ message: 'description precisa ser um texto.' })
  @MaxLength(500, { message: 'description pode ter no máximo 500 caracteres.' })
  description?: string;
}

export class UpdateApplicationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Desativar interrompe **imediatamente** o acesso de todas as chaves desta aplicação.',
  })
  @IsOptional()
  @IsBoolean({ message: 'active precisa ser verdadeiro ou falso.' })
  active?: boolean;
}

export class CreateApiKeyDto {
  @ApiProperty({ example: 'produção', description: 'Rótulo para identificar a chave depois.' })
  @IsString({ message: 'name precisa ser um texto.' })
  @MinLength(1, { message: 'name é obrigatório.' })
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    description: 'Lista vazia ou omitida concede todos os escopos.',
    enum: API_SCOPES,
    isArray: true,
    example: ['sessions:read', 'messages:send'],
  })
  @IsOptional()
  @IsArray({ message: 'scopes precisa ser uma lista.' })
  @IsIn(API_SCOPES as unknown as string[], {
    each: true,
    message: `Escopo inválido. Válidos: ${API_SCOPES.join(', ')}.`,
  })
  scopes?: string[];

  @ApiPropertyOptional({
    description: 'Data de expiração (ISO 8601). Sem ela, a chave não expira.',
    example: '2027-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'expiresAt precisa ser uma data ISO 8601.' })
  expiresAt?: string;
}
