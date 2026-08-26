import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentApiKey } from '../../common/decorators/current-app.decorator';
import { Scopes } from '../../common/decorators/scopes.decorator';
import { ProblemDetails } from '../../common/errors/problem-details';

import {
  SendContactDto,
  SendLocationDto,
  SendMediaDto,
  SendReactionDto,
  SendResultDto,
  SendSeenDto,
  SendTextDto,
  TypingDto,
} from './dto/send.dto';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { MessagesService } from './messages.service';

import type { AuthenticatedApiKey } from '../api-keys/api-key.types';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description:
    'Identificador seu para esta operação. Repetir a requisição com a mesma chave ' +
    'devolve o resultado original em vez de enviar de novo — é a forma segura de ' +
    'ter retry sem duplicar a mensagem no aparelho do destinatário. Validade: 24 horas.',
};

@ApiTags('Mensagens')
@ApiSecurity('ApiKeyAuth')
@ApiNotFoundResponse({
  description: 'A sessão não existe ou pertence a outra aplicação.',
  type: ProblemDetails,
})
@ApiConflictResponse({
  description: 'A sessão não está conectada, ou o destinatário/arquivo é inválido.',
  type: ProblemDetails,
})
@Controller('v1/messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post('text')
  @Scopes('messages:send')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: 'Enviar texto',
    description:
      'O destinatário pode ser informado em `to` (número com código do país) ou ' +
      '`chatId` (formato do WhatsApp).',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: SendResultDto })
  sendText(
    @Body() dto: SendTextDto,
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
  ): Promise<SendResultDto> {
    return this.messages.sendText(dto, apiKey);
  }

  @Post('image')
  @Scopes('messages:send')
  @UseInterceptors(IdempotencyInterceptor, FileInterceptor('file'))
  @ApiOperation({
    summary: 'Enviar imagem',
    description:
      'O arquivo pode vir por `url`, `base64` ou upload multipart no campo `file` — ' +
      'exatamente uma dessas formas. URLs apontando para endereços internos são ' +
      'recusadas por segurança.',
  })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: SendResultDto })
  sendImage(
    @Body() dto: SendMediaDto,
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<SendResultDto> {
    return this.messages.sendMedia('image', dto, apiKey, file);
  }

  @Post('file')
  @Scopes('messages:send')
  @UseInterceptors(IdempotencyInterceptor, FileInterceptor('file'))
  @ApiOperation({ summary: 'Enviar documento' })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: SendResultDto })
  sendFile(
    @Body() dto: SendMediaDto,
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<SendResultDto> {
    return this.messages.sendMedia('file', dto, apiKey, file);
  }

  @Post('voice')
  @Scopes('messages:send')
  @UseInterceptors(IdempotencyInterceptor, FileInterceptor('file'))
  @ApiOperation({
    summary: 'Enviar áudio',
    description:
      'O WhatsApp espera OGG/Opus. Use `convert: true` para converter automaticamente ' +
      'a partir de outros formatos.',
  })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: SendResultDto })
  sendVoice(
    @Body() dto: SendMediaDto,
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<SendResultDto> {
    return this.messages.sendMedia('voice', dto, apiKey, file);
  }

  @Post('video')
  @Scopes('messages:send')
  @UseInterceptors(IdempotencyInterceptor, FileInterceptor('file'))
  @ApiOperation({ summary: 'Enviar vídeo' })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: SendResultDto })
  sendVideo(
    @Body() dto: SendMediaDto,
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<SendResultDto> {
    return this.messages.sendMedia('video', dto, apiKey, file);
  }

  @Post('location')
  @Scopes('messages:send')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Enviar localização' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: SendResultDto })
  sendLocation(
    @Body() dto: SendLocationDto,
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
  ): Promise<SendResultDto> {
    return this.messages.sendLocation(dto, apiKey);
  }

  @Post('contact')
  @Scopes('messages:send')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Enviar contato' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: SendResultDto })
  sendContact(
    @Body() dto: SendContactDto,
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
  ): Promise<SendResultDto> {
    return this.messages.sendContact(dto, apiKey);
  }

  @Post('reaction')
  @Scopes('messages:send')
  @ApiOperation({ summary: 'Reagir a uma mensagem', description: 'Emoji vazio remove a reação.' })
  sendReaction(@Body() dto: SendReactionDto, @CurrentApiKey() apiKey: AuthenticatedApiKey) {
    return this.messages.sendReaction(dto, apiKey);
  }

  @Post('seen')
  @Scopes('messages:send')
  @ApiOperation({ summary: 'Marcar como lida' })
  sendSeen(@Body() dto: SendSeenDto, @CurrentApiKey() apiKey: AuthenticatedApiKey) {
    return this.messages.sendSeen(dto, apiKey);
  }

  @Post('typing')
  @Scopes('messages:send')
  @ApiOperation({
    summary: 'Indicar digitação',
    description: 'Mostra "digitando..." no aparelho do destinatário.',
  })
  @ApiBody({ type: TypingDto })
  setTyping(@Body() dto: TypingDto, @CurrentApiKey() apiKey: AuthenticatedApiKey) {
    return this.messages.setTyping(dto, apiKey);
  }
}
