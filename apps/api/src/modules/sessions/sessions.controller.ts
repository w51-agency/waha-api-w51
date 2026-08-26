import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentApiKey, CurrentApplication } from '../../common/decorators/current-app.decorator';
import { Scopes } from '../../common/decorators/scopes.decorator';
import { ProblemDetails } from '../../common/errors/problem-details';

import {
  CreateSessionDto,
  ListSessionsQuery,
  PairingCodeDto,
  UpdateSessionDto,
} from './dto/session.dto';
import { PairingCodeResponse, QrCodeResponse, SessionResponse } from './dto/session.response';
import { SessionsService } from './sessions.service';

import type { AuthenticatedApiKey } from '../api-keys/api-key.types';
import type { Request, Response } from 'express';

@ApiTags('Sessões')
@ApiSecurity('ApiKeyAuth')
@ApiNotFoundResponse({
  description: 'A sessão não existe ou pertence a outra aplicação.',
  type: ProblemDetails,
})
@Controller('v1/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @Scopes('sessions:write')
  @ApiOperation({
    summary: 'Criar uma sessão',
    description:
      'Cria uma sessão e a inicia. O próximo passo é buscar o QR code em ' +
      '`GET /v1/sessions/{id}/qr` e escaneá-lo com o WhatsApp do celular. ' +
      'Assim que o número conectar, `phoneNumber` é preenchido automaticamente.',
  })
  @ApiOkResponse({ type: SessionResponse })
  create(
    @Body() dto: CreateSessionDto,
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Req() req: Request,
  ): Promise<SessionResponse> {
    return this.sessions.create(dto, apiKey, req);
  }

  @Get()
  @Scopes('sessions:read')
  @ApiOperation({ summary: 'Listar suas sessões' })
  @ApiOkResponse({ type: [SessionResponse] })
  list(
    @CurrentApplication() app: AuthenticatedApiKey['application'],
    @Query() query: ListSessionsQuery,
  ): Promise<SessionResponse[]> {
    return this.sessions.list(app.id, query);
  }

  @Get(':id')
  @Scopes('sessions:read')
  @ApiOperation({
    summary: 'Detalhe da sessão',
    description: 'O status é conferido com o serviço de WhatsApp a cada consulta.',
  })
  @ApiOkResponse({ type: SessionResponse })
  findOne(
    @Param('id') id: string,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
  ): Promise<SessionResponse> {
    return this.sessions.findOne(id, app.id);
  }

  @Patch(':id')
  @Scopes('sessions:write')
  @ApiOperation({ summary: 'Editar apelido e metadados' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
  ): Promise<SessionResponse> {
    return this.sessions.update(id, app.id, dto);
  }

  // ===========================================================================
  //  Conexão do número
  // ===========================================================================

  @Get(':id/qr')
  @Scopes('sessions:write')
  @ApiOperation({
    summary: 'Obter o QR code para conectar o número',
    description:
      'Devolve o conteúdo do QR e a mesma imagem em base64.\n\n' +
      '**O QR do WhatsApp expira em cerca de 20 segundos.** Renove antes disso ' +
      '(o campo `expiresInSeconds` indica a janela), senão o usuário lê um código ' +
      'morto e conclui que algo quebrou.\n\n' +
      'Cada chamada é registrada: contamos quantas vezes o QR foi pedido, quando, ' +
      'e por qual chave — é assim que sabemos qual sistema conectou cada número.',
  })
  @ApiOkResponse({ type: QrCodeResponse })
  @ApiConflictResponse({
    description: 'A sessão não está aguardando leitura de QR (já conectada, parada ou falha).',
    type: ProblemDetails,
  })
  getQr(
    @Param('id') id: string,
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Req() req: Request,
  ): Promise<QrCodeResponse> {
    return this.sessions.getQr(id, apiKey, req);
  }

  @Get(':id/qr.png')
  @Scopes('sessions:write')
  @ApiOperation({
    summary: 'QR code como imagem PNG',
    description: 'A mesma informação de `/qr`, servida como imagem para uso direto em `<img>`.',
  })
  @ApiProduces('image/png')
  // O QR é uma credencial de curta duração: cacheá-lo entregaria um código
  // morto na próxima leitura, e pior, poderia deixá-lo em cache compartilhado.
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Content-Type', 'image/png')
  async getQrPng(
    @Param('id') id: string,
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const png = await this.sessions.getQrImage(id, apiKey, req);
    res.send(png);
  }

  @Post(':id/pairing-code')
  @Scopes('sessions:write')
  @ApiOperation({
    summary: 'Conectar por código de pareamento',
    description:
      'Alternativa ao QR: gera um código de 8 dígitos que o usuário digita no ' +
      'WhatsApp do celular, em Aparelhos conectados.',
  })
  @ApiOkResponse({ type: PairingCodeResponse })
  requestPairingCode(
    @Param('id') id: string,
    @Body() dto: PairingCodeDto,
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Req() req: Request,
  ): Promise<PairingCodeResponse> {
    return this.sessions.requestPairingCode(id, dto.phoneNumber, apiKey, req);
  }

  // ===========================================================================
  //  Ciclo de vida
  // ===========================================================================

  @Post(':id/start')
  @Scopes('sessions:write')
  @ApiOperation({ summary: 'Iniciar a sessão', description: 'Idempotente.' })
  start(@Param('id') id: string, @CurrentApiKey() k: AuthenticatedApiKey, @Req() r: Request) {
    return this.sessions.start(id, k, r);
  }

  @Post(':id/stop')
  @Scopes('sessions:write')
  @ApiOperation({
    summary: 'Parar a sessão',
    description: 'Desconecta sem desfazer o pareamento — ao reiniciar, não pede QR de novo.',
  })
  stop(@Param('id') id: string, @CurrentApiKey() k: AuthenticatedApiKey, @Req() r: Request) {
    return this.sessions.stop(id, k, r);
  }

  @Post(':id/restart')
  @Scopes('sessions:write')
  @ApiOperation({ summary: 'Reiniciar a sessão' })
  restart(@Param('id') id: string, @CurrentApiKey() k: AuthenticatedApiKey, @Req() r: Request) {
    return this.sessions.restart(id, k, r);
  }

  @Post(':id/logout')
  @Scopes('sessions:write')
  @ApiOperation({
    summary: 'Desconectar o número',
    description: 'Desfaz o pareamento. O número precisará escanear o QR novamente para reconectar.',
  })
  logout(@Param('id') id: string, @CurrentApiKey() k: AuthenticatedApiKey, @Req() r: Request) {
    return this.sessions.logout(id, k, r);
  }

  @Delete(':id')
  @Scopes('sessions:write')
  @ApiOperation({
    summary: 'Excluir a sessão',
    description: 'Remove a sessão do serviço de WhatsApp e do gateway.',
  })
  @ApiQuery({ name: 'id', required: false })
  remove(@Param('id') id: string, @CurrentApiKey() k: AuthenticatedApiKey, @Req() r: Request) {
    return this.sessions.remove(id, k, r);
  }
}
