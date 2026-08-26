import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { SessionStatus } from '@gateway/shared';

export class SessionResponse {
  @ApiProperty({ example: 'clx1a2b3c4d5e6f7g8h9' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Comercial' })
  label!: string | null;

  @ApiProperty({
    enum: SessionStatus,
    description:
      'SCAN_QR_CODE = aguardando leitura do QR · WORKING = conectado e pronto para enviar.',
  })
  status!: SessionStatus;

  @ApiProperty({ example: 'Conectado', description: 'Status em português.' })
  statusLabel!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Preenchido quando o número conecta.',
    example: '5511999999999',
  })
  phoneNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Comercial da Empresa' })
  pushName!: string | null;

  @ApiProperty({ example: 'NOWEB' })
  engine!: string;

  @ApiProperty({
    description: 'Quantas vezes o QR code desta sessão foi solicitado.',
    example: 2,
  })
  qrRequestCount!: number;

  @ApiPropertyOptional({ nullable: true })
  lastQrRequestedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'Quando o número foi conectado.' })
  connectedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  disconnectedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'Seus dados livres.' })
  metadata!: Record<string, unknown> | null;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class QrCodeResponse {
  @ApiProperty({
    description: 'Conteúdo do QR code. Renderize como QR ou use a imagem PNG.',
    example: 'https://wa.me/settings/linked_devices#2@ABC...',
  })
  value!: string;

  @ApiProperty({
    description: 'A mesma imagem em PNG, codificada em base64 (pronta para uma tag <img>).',
  })
  imageBase64!: string;

  @ApiProperty({ enum: SessionStatus })
  status!: SessionStatus;

  @ApiProperty({
    description:
      'Segundos até este QR expirar. O WhatsApp renova o código com frequência: ' +
      'busque um novo antes de expirar, senão o usuário lê um código morto.',
    example: 20,
  })
  expiresInSeconds!: number;
}

export class PairingCodeResponse {
  @ApiProperty({ example: 'ABCD-EFGH', description: 'Digite este código no WhatsApp do celular.' })
  code!: string;
}
