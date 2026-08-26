import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { SessionStatus } from '@gateway/shared';

export class CreateSessionDto {
  @ApiPropertyOptional({
    description:
      'Apelido para você identificar este número. Único dentro da sua aplicação. ' +
      'O nome técnico da sessão é gerado por nós.',
    example: 'Comercial',
  })
  @IsOptional()
  @IsString({ message: 'label precisa ser um texto.' })
  @MinLength(1, { message: 'label não pode ser vazio.' })
  @MaxLength(80, { message: 'label pode ter no máximo 80 caracteres.' })
  label?: string;

  @ApiPropertyOptional({
    description: 'Dados livres seus, devolvidos nas consultas e nos webhooks.',
    example: { setor: 'vendas', responsavel: 'time-1' },
  })
  @IsOptional()
  @IsObject({ message: 'metadata precisa ser um objeto.' })
  metadata?: Record<string, unknown>;
}

export class UpdateSessionDto {
  @ApiPropertyOptional({ example: 'Comercial SP' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class PairingCodeDto {
  @ApiProperty({
    description: 'Número com código do país, somente dígitos.',
    example: '5511999999999',
  })
  @IsString({ message: 'phoneNumber precisa ser um texto.' })
  @Matches(/^\d{10,15}$/, {
    message: 'phoneNumber precisa ter de 10 a 15 dígitos, incluindo o código do país.',
  })
  phoneNumber!: string;
}

export class ListSessionsQuery {
  @ApiPropertyOptional({ enum: SessionStatus })
  @IsOptional()
  @IsEnum(SessionStatus, { message: 'status inválido.' })
  status?: SessionStatus;

  @ApiPropertyOptional({ description: 'Busca por apelido ou número.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}
