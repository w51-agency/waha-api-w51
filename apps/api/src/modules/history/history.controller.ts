import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentApplication } from '../../common/decorators/current-app.decorator';
import { Scopes } from '../../common/decorators/scopes.decorator';
import { ProblemDetails } from '../../common/errors/problem-details';

import {
  CheckNumberQuery,
  ListChatsQuery,
  ListMessagesQuery,
  MessageDetailQuery,
} from './dto/history.dto';
import {
  ChatResponse,
  MessageResponse,
  NumberCheckResponse,
  PaginatedMessages,
} from './dto/history.response';
import { HistoryService } from './history.service';

import type { AuthenticatedApiKey } from '../api-keys/api-key.types';
import type { Response } from 'express';

@ApiTags('Mensagens')
@ApiSecurity('ApiKeyAuth')
@Controller('v1/messages')
export class MessagesHistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  @Scopes('messages:read')
  @ApiOperation({
    summary: 'Consultar o histórico',
    description:
      'Lista as mensagens que passaram por este gateway, das mais recentes para as ' +
      'mais antigas.\n\n' +
      '**Paginação por cursor.** Use o `nextCursor` da resposta em `?cursor=` para ' +
      'buscar a página seguinte. Diferente de offset, o cursor não repete nem pula ' +
      'registros quando chegam mensagens novas durante a navegação. Quando ' +
      '`nextCursor` vier nulo, acabou.',
  })
  @ApiOkResponse({ type: PaginatedMessages })
  list(
    @CurrentApplication() app: AuthenticatedApiKey['application'],
    @Query() query: ListMessagesQuery,
  ): Promise<PaginatedMessages> {
    return this.history.listMessages(app.id, query);
  }

  @Get('export')
  @Scopes('messages:read')
  @ApiOperation({
    summary: 'Exportar o histórico em CSV',
    description: 'Aceita os mesmos filtros da listagem. A resposta é transmitida em fluxo.',
  })
  @ApiProduces('text/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="mensagens.csv"')
  async export(
    @CurrentApplication() app: AuthenticatedApiKey['application'],
    @Query() query: ListMessagesQuery,
    @Res() res: Response,
  ): Promise<void> {
    // BOM para o Excel reconhecer UTF-8 e não corromper acentuação.
    res.write('﻿');

    for await (const linha of this.history.exportCsv(app.id, query)) {
      res.write(linha);
    }

    res.end();
  }

  @Get(':id')
  @Scopes('messages:read')
  @ApiOperation({ summary: 'Detalhe de uma mensagem' })
  @ApiOkResponse({ type: MessageResponse })
  @ApiNotFoundResponse({ type: ProblemDetails })
  findOne(
    @Param('id') id: string,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
    @Query() query: MessageDetailQuery,
  ): Promise<MessageResponse> {
    return this.history.findMessage(id, app.id, query.includeRaw === true);
  }
}

@ApiTags('Chats & Contatos')
@ApiSecurity('ApiKeyAuth')
@Controller('v1/sessions')
export class ChatsController {
  constructor(private readonly history: HistoryService) {}

  @Get(':id/chats')
  @Scopes('chats:read')
  @ApiOperation({
    summary: 'Listar conversas do aparelho',
    description:
      'Lê as conversas direto do dispositivo conectado — inclui conversas anteriores à ' +
      'conexão. Diferente de `GET /v1/messages`, que traz apenas o que passou por este ' +
      'gateway. Exige a sessão conectada.',
  })
  @ApiOkResponse({ type: [ChatResponse] })
  listChats(
    @Param('id') sessionId: string,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
    @Query() query: ListChatsQuery,
  ): Promise<ChatResponse[]> {
    return this.history.listChats(sessionId, app.id, query);
  }

  @Get(':id/chats/:chatId/messages')
  @Scopes('chats:read')
  @ApiOperation({ summary: 'Mensagens de uma conversa, lidas do aparelho' })
  @ApiOkResponse({ type: [MessageResponse] })
  listChatMessages(
    @Param('id') sessionId: string,
    @Param('chatId') chatId: string,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
    @Query('limit') limit?: string,
  ): Promise<MessageResponse[]> {
    return this.history.listChatMessages(sessionId, app.id, chatId, Number(limit ?? 50));
  }

  @Get(':id/contacts/check')
  @Scopes('chats:read')
  @ApiOperation({
    summary: 'Verificar se um número tem WhatsApp',
    description: 'Consulte antes de enviar, para não registrar falhas evitáveis.',
  })
  @ApiOkResponse({ type: NumberCheckResponse })
  checkNumber(
    @Param('id') sessionId: string,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
    @Query() query: CheckNumberQuery,
  ): Promise<NumberCheckResponse> {
    return this.history.checkNumber(sessionId, app.id, query.phone);
  }
}

@ApiTags('Mídia')
@ApiSecurity('ApiKeyAuth')
@Controller('v1/media')
export class MediaController {
  constructor(private readonly history: HistoryService) {}

  @Get(':messageId')
  @Scopes('messages:read')
  @ApiOperation({
    summary: 'Baixar a mídia de uma mensagem',
    description:
      'Serve o arquivo autenticando pela sua API key. O serviço de WhatsApp nunca é ' +
      'exposto diretamente — este endpoint é o único caminho para os arquivos.\n\n' +
      'Arquivos ficam disponíveis por tempo limitado após o recebimento.',
  })
  @ApiProduces('application/octet-stream')
  @ApiNotFoundResponse({
    description: 'Mensagem inexistente, sem mídia, ou mídia já expirada.',
    type: ProblemDetails,
  })
  // Privado, nunca em cache compartilhado: o arquivo é de uma conversa.
  @Header('Cache-Control', 'private, max-age=3600')
  async download(
    @Param('messageId') messageId: string,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
    @Res() res: Response,
  ): Promise<void> {
    const { corpo, contentType, filename } = await this.history.fetchMedia(messageId, app.id);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', corpo.length);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(corpo);
  }
}
