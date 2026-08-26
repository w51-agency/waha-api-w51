import { ApiProperty } from '@nestjs/swagger';

class AdminUser {
  @ApiProperty({ example: 'admin' })
  username!: string;
}

export class LoginResponse {
  @ApiProperty({ description: 'JWT de acesso. Envie em Authorization: Bearer.' })
  accessToken!: string;

  @ApiProperty({ description: 'Token de renovação. Rotacionado a cada uso.' })
  refreshToken!: string;

  @ApiProperty({ description: 'Validade do accessToken, em segundos.', example: 900 })
  expiresIn!: number;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({ type: AdminUser })
  user!: AdminUser;
}
