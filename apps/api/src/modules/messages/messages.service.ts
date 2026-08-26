import { Injectable, Logger } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../common/errors/problem-details';
import { AppConfig } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { WahaClient } from '../waha/waha.client';

import { normalizeChatId } from './chat-id';
import { assertBase64DentroDoLimite, assertUrlDeMidiaSegura } from './media-source';

import type {
  BaseSendDto,
  SendContactDto,
  SendLocationDto,
  SendMediaDto,
  SendReactionDto,
  SendResultDto,
  SendSeenDto,
  SendTextDto,
} from './dto/send.dto';
import type { AuthenticatedApiKey } from '../api-keys/api-key.types';
import type { Session } from '../../generated/prisma/client';
import type { WahaFile, WahaMessage } from '@gateway/shared';

import { Direction, MessageStatus, SessionStatus } from '@gateway/shared';

type TipoMidia = 'image' | 'file' | 'voice' | 'video';

/** Arquivo já resolvido a partir de url, base64 ou upload. */
interface ArquivoResolvido {
  file: WahaFile;
  mimetype: string;
  filename?: string;
  tamanhoBytes?: number;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {}

  // ===========================================================================
  //  Envio
  // ===========================================================================

  async sendText(dto: SendTextDto, apiKey: AuthenticatedApiKey): Promise<SendResultDto> {
    const { session, chatId } = await this.preparar(dto, apiKey);

    return this.executar(session, chatId, 'text', dto.text, apiKey, () =>
      this.waha.sendText({
        session: session.name,
        chatId,
        text: dto.text,
        linkPreview: dto.linkPreview ?? true,
        ...(dto.mentions?.length ? { mentions: dto.mentions } : {}),
        ...(dto.replyTo ? { reply_to: dto.replyTo } : {}),
      }),
    );
  }

  async sendMedia(
    tipo: TipoMidia,
    dto: SendMediaDto,
    apiKey: AuthenticatedApiKey,
    upload?: { buffer: Buffer; mimetype: string; originalname: string },
  ): Promise<SendResultDto> {
    const { session, chatId } = await this.preparar(dto, apiKey);
    const arquivo = await this.resolverArquivo(dto, upload, tipo);

    const metodos = {
      image: () => this.waha.sendImage(payload),
      file: () => this.waha.sendFile(payload),
      voice: () => this.waha.sendVoice(payload),
      video: () => this.waha.sendVideo(payload),
    };

    const payload = {
      session: session.name,
      chatId,
      file: arquivo.file,
      ...(dto.caption ? { caption: dto.caption } : {}),
      ...(dto.replyTo ? { reply_to: dto.replyTo } : {}),
      ...(dto.convert !== undefined ? { convert: dto.convert } : {}),
      ...(dto.asNote !== undefined ? { asNote: dto.asNote } : {}),
    };

    return this.executar(
      session,
      chatId,
      tipo === 'file' ? 'document' : tipo,
      dto.caption ?? arquivo.filename ?? null,
      apiKey,
      metodos[tipo],
      { mediaMimeType: arquivo.mimetype, mediaSize: arquivo.tamanhoBytes ?? null },
    );
  }

  async sendLocation(dto: SendLocationDto, apiKey: AuthenticatedApiKey): Promise<SendResultDto> {
    const { session, chatId } = await this.preparar(dto, apiKey);

    return this.executar(
      session,
      chatId,
      'location',
      dto.title ?? `${dto.latitude},${dto.longitude}`,
      apiKey,
      () =>
        this.waha.sendLocation({
          session: session.name,
          chatId,
          latitude: dto.latitude,
          longitude: dto.longitude,
          ...(dto.title ? { title: dto.title } : {}),
        }),
    );
  }

  async sendContact(dto: SendContactDto, apiKey: AuthenticatedApiKey): Promise<SendResultDto> {
    const { session, chatId } = await this.preparar(dto, apiKey);

    return this.executar(session, chatId, 'contact', dto.fullName, apiKey, () =>
      this.waha.sendContact({
        session: session.name,
        chatId,
        contacts: [{ fullName: dto.fullName, phoneNumber: dto.phoneNumber }],
      }),
    );
  }

  async sendReaction(dto: SendReactionDto, apiKey: AuthenticatedApiKey): Promise<{ ok: true }> {
    const session = await this.sessaoOperavel(dto.sessionId, apiKey.application.id);

    await this.waha.setReaction({
      session: session.name,
      messageId: dto.messageId,
      reaction: dto.emoji,
    });

    return { ok: true };
  }

  async sendSeen(dto: SendSeenDto, apiKey: AuthenticatedApiKey): Promise<{ ok: true }> {
    const { session, chatId } = await this.preparar(dto, apiKey);

    await this.waha.sendSeen({
      session: session.name,
      chatId,
      ...(dto.messageIds?.length ? { messageIds: dto.messageIds } : {}),
    });

    return { ok: true };
  }

  async setTyping(
    dto: BaseSendDto & { action: 'start' | 'stop' },
    apiKey: AuthenticatedApiKey,
  ): Promise<{ ok: true }> {
    const { session, chatId } = await this.preparar(dto, apiKey);

    if (dto.action === 'start') await this.waha.startTyping(session.name, chatId);
    else await this.waha.stopTyping(session.name, chatId);

    return { ok: true };
  }

  // ===========================================================================
  //  Idempotência
  // ===========================================================================

  /**
   * Devolve o resultado já registrado para uma chave de idempotência.
   *
   * Existe porque **envio não é retentável automaticamente** (tarefa 07): um
   * timeout pode significar "entregue, resposta perdida". Este é o mecanismo que
   * dá ao integrador um retry seguro — repetir com a mesma chave devolve o
   * resultado original em vez de enviar de novo.
   */
  async buscarIdempotente(
    chave: string,
    applicationId: string,
  ): Promise<SendResultDto | 'em-andamento' | null> {
    const registro = await this.redis.client.get(chaveRedis(chave, applicationId));
    if (!registro) return null;
    if (registro === 'PENDING') return 'em-andamento';
    return JSON.parse(registro) as SendResultDto;
  }

  /**
   * Reserva a chave antes do envio.
   *
   * `SET NX` atômico: se duas requisições concorrentes chegarem com a mesma
   * chave, só uma passa. A outra recebe 409 em vez de enviar em duplicidade.
   */
  async reservarIdempotencia(chave: string, applicationId: string): Promise<boolean> {
    const r = await this.redis.client.set(
      chaveRedis(chave, applicationId),
      'PENDING',
      'EX',
      86_400,
      'NX',
    );
    return r === 'OK';
  }

  async registrarIdempotencia(
    chave: string,
    applicationId: string,
    resultado: SendResultDto,
  ): Promise<void> {
    await this.redis.client.setex(
      chaveRedis(chave, applicationId),
      86_400,
      JSON.stringify(resultado),
    );
  }

  /** Libera a reserva quando o envio falha, para o integrador poder tentar de novo. */
  async liberarIdempotencia(chave: string, applicationId: string): Promise<void> {
    await this.redis.client.del(chaveRedis(chave, applicationId));
  }

  // ===========================================================================
  //  Núcleo
  // ===========================================================================

  /**
   * Executa um envio, registrando antes e depois.
   *
   * A mensagem é gravada como `QUEUED` **antes** da chamada ao WAHA. Isso importa:
   * se o processo cair no meio, fica o registro do que foi tentado, em vez de um
   * envio invisível. E se o WAHA falhar, o registro vira `FAILED` com o motivo —
   * o integrador consegue investigar pelo id devolvido, mesmo em erro.
   */
  private async executar(
    session: Session,
    chatId: string,
    tipo: string,
    corpo: string | null,
    apiKey: AuthenticatedApiKey,
    enviar: () => Promise<WahaMessage>,
    extras: Record<string, unknown> = {},
  ): Promise<SendResultDto> {
    const mensagem = await this.prisma.message.create({
      data: {
        applicationId: session.applicationId,
        sessionId: session.id,
        direction: Direction.OUTBOUND,
        chatId,
        fromMe: true,
        type: tipo,
        body: corpo,
        status: MessageStatus.QUEUED,
        sentByApiKeyId: apiKey.id,
        timestamp: new Date(),
        ...extras,
      },
    });

    try {
      const resposta = await enviar();

      const atualizada = await this.prisma.message.update({
        where: { id: mensagem.id },
        data: {
          wahaId: resposta.id ?? null,
          status: MessageStatus.SENT,
          ack: typeof resposta.ack === 'number' ? resposta.ack : null,
          ackName: resposta.ackName ?? null,
          raw: resposta as never,
        },
      });

      return toSendResult(atualizada);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);

      const falha = await this.prisma.message.update({
        where: { id: mensagem.id },
        data: { status: MessageStatus.FAILED, error: motivo.slice(0, 2000) },
      });

      this.logger.warn(`Envio falhou (${session.name} -> ${chatId}): ${motivo}`);

      // Relança para o filtro global traduzir. O registro FAILED já existe, e o
      // id vai na resposta de erro para o integrador conseguir investigar.
      throw erro;
    }
  }

  private async preparar(
    dto: BaseSendDto,
    apiKey: AuthenticatedApiKey,
  ): Promise<{ session: Session; chatId: string }> {
    const destino = dto.chatId ?? dto.to;

    if (!destino) {
      throw new ConflictError(
        'Informe o destinatário em "to" (número) ou "chatId".',
        'missing-recipient',
      );
    }

    const session = await this.sessaoOperavel(dto.sessionId, apiKey.application.id);

    return { session, chatId: normalizeChatId(destino) };
  }

  /**
   * Busca a sessão garantindo posse e prontidão.
   *
   * Checar o status antes de chamar o WAHA transforma um erro obscuro do serviço
   * externo em uma mensagem que diz o que fazer.
   */
  private async sessaoOperavel(sessionId: string, applicationId: string): Promise<Session> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, applicationId },
    });

    // 404 e não 403: um 403 confirmaria que o id existe em outra aplicação.
    if (!session) throw new NotFoundError('Sessão não encontrada.', 'session-not-found');

    if (session.status !== SessionStatus.WORKING) {
      throw new ConflictError(mensagemSessaoIndisponivel(session), 'session-not-working', {
        status: session.status,
      });
    }

    return session;
  }

  /** Resolve o arquivo a partir de upload, base64 ou URL — exatamente uma origem. */
  private async resolverArquivo(
    dto: SendMediaDto,
    upload: { buffer: Buffer; mimetype: string; originalname: string } | undefined,
    tipo: TipoMidia,
  ): Promise<ArquivoResolvido> {
    const origens = [
      upload ? 'upload' : null,
      dto.base64 ? 'base64' : null,
      dto.url ? 'url' : null,
    ].filter(Boolean).length;

    if (origens === 0) {
      throw new ConflictError(
        'Envie o arquivo de uma destas formas: campo `url`, campo `base64` ou upload multipart.',
        'missing-file',
      );
    }

    if (origens > 1) {
      throw new ConflictError(
        'Envie o arquivo por apenas uma origem: `url`, `base64` ou upload.',
        'ambiguous-file',
      );
    }

    const limite = this.config.maxMediaSizeBytes;

    if (upload) {
      if (upload.buffer.length > limite) {
        throw new ConflictError(
          `O arquivo tem ${(upload.buffer.length / 1048576).toFixed(1)} MB, ` +
            `acima do limite de ${this.config.get('MAX_MEDIA_SIZE_MB')} MB.`,
          'file-too-large',
        );
      }

      const mimetype = upload.mimetype || mimetypePadrao(tipo);

      return {
        file: {
          mimetype,
          data: upload.buffer.toString('base64'),
          filename: dto.filename ?? upload.originalname,
        },
        mimetype,
        filename: dto.filename ?? upload.originalname,
        tamanhoBytes: upload.buffer.length,
      };
    }

    if (dto.base64) {
      const buffer = assertBase64DentroDoLimite(dto.base64, limite);
      const mimetype = dto.mimetype ?? mimetypePadrao(tipo);

      return {
        file: {
          mimetype,
          data: buffer.toString('base64'),
          ...(dto.filename ? { filename: dto.filename } : {}),
        },
        mimetype,
        filename: dto.filename,
        tamanhoBytes: buffer.length,
      };
    }

    // URL: valida contra SSRF antes de repassar ao WAHA, que roda na nossa rede.
    const url = await assertUrlDeMidiaSegura(dto.url!);
    const mimetype = dto.mimetype ?? mimetypePadrao(tipo);

    return {
      file: {
        mimetype,
        url: url.toString(),
        ...(dto.filename ? { filename: dto.filename } : {}),
      },
      mimetype,
      filename: dto.filename,
    };
  }
}

// =============================================================================
//  Apoio
// =============================================================================

const chaveRedis = (chave: string, applicationId: string) => `idem:${applicationId}:${chave}`;

function mimetypePadrao(tipo: TipoMidia): string {
  return {
    image: 'image/jpeg',
    file: 'application/octet-stream',
    voice: 'audio/ogg; codecs=opus',
    video: 'video/mp4',
  }[tipo];
}

function mensagemSessaoIndisponivel(session: Session): string {
  const mensagens: Record<string, string> = {
    [SessionStatus.SCAN_QR_CODE]:
      'A sessão ainda não foi conectada. Escaneie o QR code em GET /v1/sessions/{id}/qr.',
    [SessionStatus.STOPPED]: 'A sessão está parada. Chame POST /v1/sessions/{id}/start.',
    [SessionStatus.STARTING]: 'A sessão está iniciando. Tente novamente em alguns segundos.',
    [SessionStatus.FAILED]: 'A sessão falhou. Chame POST /v1/sessions/{id}/restart.',
  };

  return (
    mensagens[session.status] ??
    `A sessão está com status "${session.status}" e não pode enviar mensagens.`
  );
}

export function toSendResult(mensagem: {
  id: string;
  wahaId: string | null;
  status: string;
  chatId: string;
  timestamp: Date;
  error: string | null;
}): SendResultDto {
  return {
    id: mensagem.id,
    wahaId: mensagem.wahaId,
    status: mensagem.status,
    chatId: mensagem.chatId,
    timestamp: mensagem.timestamp,
    error: mensagem.error,
  };
}
