import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString({ message: 'username precisa ser um texto.' })
  @MinLength(1, { message: 'username é obrigatório.' })
  username!: string;

  @ApiProperty({ example: 'sua-senha' })
  @IsString({ message: 'password precisa ser um texto.' })
  @MinLength(1, { message: 'password é obrigatório.' })
  password!: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'O refreshToken devolvido no login.' })
  @IsString({ message: 'refreshToken precisa ser um texto.' })
  @MinLength(1, { message: 'refreshToken é obrigatório.' })
  refreshToken!: string;
}
