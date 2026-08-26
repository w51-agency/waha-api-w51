import { Injectable, Logger } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../common/errors/problem-details';
import { AppConfig } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { phoneFromChatId } from '../messages/chat-id';
import { WahaClient } from '../waha/waha.client';

import { cursorWhere, decodeCursor, encodeCursor } from './cursor';

import type { ListChatsQuery, ListMessagesQuery } from './dto/history.dto';
import type {
  ChatResponse,
  MessageResponse,
  NumberCheckResponse,
  PaginatedMessages,
} from './dto/history.response';
import type { Message, Session } from '../../generated/prisma/client';

import { Direction, MessageStatus, SessionStatus } from '@gateway/shared';

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {}

  // ===========================================================================
  //  Histórico do gateway
  // ===========================================================================

  async listMessages(applicationId: string, query: ListMessagesQuery): Promise<PaginatedMessages> {
    const limite = Math.min(query.limit ?? 50, this.config.get('MAX_PAGE_SIZE'));

    // Se o integrador filtrar por uma sessão de outra aplicação, o filtro por
    // applicationId já devolveria vazio — mas um 404 explícito é mais honesto
    // do que uma lista vazia que parece "não há mensagens".
    if (query.sessionId) {
      const existe = await this.prisma.session.findFirst({
        where: { id: query.sessionId, applicationId },
        select: { id: true },
      });
      if (!existe) throw new NotFoundError('Sessão não encontrada.', 'session-not-found');
    }

    const where = {
      applicationId,
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.chatId ? { chatId: query.chatId } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            timestamp: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search ? { body: { contains: query.search, mode: 'insensitive' as const } } : {}),
      ...(query.cursor ? cursorWhere(decodeCursor(query.cursor)) : {}),
    };

    // Buscamos um a mais que o limite para saber se há próxima página sem
    // precisar de um COUNT — que varreria a tabela inteira a cada requisição.
    const registros = await this.prisma.message.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: limite + 1,
      include: { session: { select: { label: true } } },
    });

    const hasMore = registros.length > limite;
    const pagina = hasMore ? registros.slice(0, limite) : registros;
    const ultimo = pagina.at(-1);

    return {
      data: pagina.map((m) => toMessageResponse(m, m.session?.label ?? null)),
      nextCursor:
        hasMore && ultimo ? encodeCursor({ timestamp: ultimo.timestamp, id: ultimo.id }) : null,
      hasMore,
    };
  }

  async findMessage(
    id: string,
    applicationId: string,
    includeRaw = false,
  ): Promise<MessageResponse> {
    const mensagem = await this.prisma.message.findFirst({
      where: { id, applicationId },
      include: { session: { select: { label: true } } },
    });

    if (!mensagem) throw new NotFoundError('Mensagem não encontrada.', 'message-not-found');

    const resposta = toMessageResponse(mensagem, mensagem.session?.label ?? null);

    if (includeRaw) resposta.raw = mensagem.raw;

    return resposta;
  }

  /** Exportação em CSV, respeitando os mesmos filtros. */
  async *exportCsv(
    applicationId: string,
    query: ListMessagesQuery,
    maxLinhas = 50_000,
  ): AsyncGenerator<string> {
    yield 'data,direcao,sessao,numero,tipo,status,conteudo\n';

    let cursor = query.cursor;
    let enviadas = 0;

    while (enviadas < maxLinhas) {
      const pagina: PaginatedMessages = await this.listMessages(applicationId, {
        ...query,
        cursor,
        limit: 500,
      });

      if (pagina.data.length === 0) break;

      for (const m of pagina.data) {
        yield [
          m.timestamp.toISOString(),
          m.direction,
          csv(m.sessionLabel ?? ''),
          m.phone,
          m.type,
          m.status,
          csv(m.body ?? ''),
        ].join(',') + '\n';

        if (++enviadas >= maxLinhas) break;
      }

      if (!pagina.nextCursor) break;
      cursor = pagina.nextCursor;
    }
  }

  // ===========================================================================
  //  Leitura ao vivo do aparelho (store do NOWEB)
  // ===========================================================================

  async listChats(
    sessionId: string,
    applicationId: string,
    query: ListChatsQuery,
  ): Promise<ChatResponse[]> {
    const session = await this.sessaoConectada(sessionId, applicationId);

    const limite = query.limit ?? 50;
    const offset = query.offset ?? 0;

    // Cache curto: o painel recarrega com frequência e a lista de conversas
    // tolera alguns segundos de defasagem. Sem ele, cada abertura de tela
    // martelaria o WAHA.
    const chaveCache = `chats:${session.id}:${limite}:${offset}`;
    const cacheado = await this.redis.client.get(chaveCache);
    if (cacheado) return JSON.parse(cacheado) as ChatResponse[];

    const chats = await this.waha.getChats(session.name, limite, offset);

    const resposta = chats.map((c) => ({
      id: c.id,
      name: c.name ?? null,
      lastMessageAt: c.conversationTimestamp ? new Date(c.conversationTimestamp * 1000) : null,
      unreadCount: c.unreadCount ?? 0,
    }));

    await this.redis.client.setex(chaveCache, 30, JSON.stringify(resposta));

    return resposta;
  }

  async listChatMessages(
    sessionId: string,
    applicationId: string,
    chatId: string,
    limit = 50,
  ): Promise<MessageResponse[]> {
    const session = await this.sessaoConectada(sessionId, applicationId);
    const mensagens = await this.waha.getChatMessages(session.name, chatId, limit);

    return mensagens.map((m) => ({
      id: m.id,
      wahaId: m.id,
      sessionId: session.id,
      sessionLabel: session.label,
      direction: m.fromMe ? Direction.OUTBOUND : Direction.INBOUND,
      chatId,
      phone: phoneFromChatId(chatId),
      type: m.media?.mimetype ? 'media' : 'text',
      body: m.body ?? null,
      // A URL interna do WAHA nunca sai: só indicamos que há mídia.
      mediaUrl: m.media?.url ? '(disponível apenas em mensagens registradas)' : null,
      mediaMimeType: m.media?.mimetype ?? null,
      mediaSize: null,
      status: m.fromMe ? MessageStatus.SENT : MessageStatus.DELIVERED,
      ack: typeof m.ack === 'number' ? m.ack : null,
      error: null,
      sentByApiKeyId: null,
      timestamp: new Date((m.timestamp ?? 0) * 1000),
    }));
  }

  async checkNumber(
    sessionId: string,
    applicationId: string,
    phone: string,
  ): Promise<NumberCheckResponse> {
    const session = await this.sessaoConectada(sessionId, applicationId);
    const digitos = phone.replace(/\D/g, '');

    const resultado = await this.waha.checkNumberExists(session.name, digitos);

    return {
      exists: resultado.numberExists === true,
      chatId: resultado.chatId ?? (resultado.numberExists ? `${digitos}@c.us` : null),
    };
  }

  // ===========================================================================
  //  Proxy de mídia
  // ===========================================================================

  /**
   * Baixa a mídia de uma mensagem.
   *
   * É requisito de segurança, não conveniência: a URL que o WAHA devolve aponta
   * para dentro da rede Docker. Repassá-la ao integrador vazaria a topologia e
   * simplesmente não funcionaria de fora. Aqui validamos a chave, conferimos que
   * a mensagem é da aplicação e transmitimos o conteúdo.
   */
  async fetchMedia(
    messageId: string,
    applicationId: string,
  ): Promise<{ corpo: Buffer; contentType: string; filename: string }> {
    const mensagem = await this.prisma.message.findFirst({
      where: { id: messageId, applicationId },
    });

    if (!mensagem) throw new NotFoundError('Mensagem não encontrada.', 'message-not-found');

    if (!mensagem.mediaUrl) {
      throw new NotFoundError('Esta mensagem não possui mídia.', 'no-media');
    }

    try {
      const { corpo, contentType } = await this.waha.downloadMedia(mensagem.mediaUrl);

      return {
        corpo,
        contentType: mensagem.mediaMimeType ?? contentType,
        filename: nomeDeArquivo(mensagem),
      };
    } catch (erro) {
      this.logger.warn(`Mídia indisponível para ${messageId}: ${String(erro)}`);
      throw new NotFoundError(
        'A mídia não está mais disponível. Arquivos ficam acessíveis por tempo limitado ' +
          'após o recebimento.',
        'media-expired',
      );
    }
  }

  // ===========================================================================
  //  Apoio
  // ===========================================================================

  private async sessaoConectada(sessionId: string, applicationId: string): Promise<Session> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, applicationId },
    });

    if (!session) throw new NotFoundError('Sessão não encontrada.', 'session-not-found');

    if (session.status !== SessionStatus.WORKING) {
      throw new ConflictError(
        'A sessão precisa estar conectada para ler conversas do aparelho. ' +
          `Status atual: ${session.status}.`,
        'session-not-working',
      );
    }

    return session;
  }
}

// =============================================================================
//  Serialização
// =============================================================================

/**
 * Converte para resposta.
 *
 * `mediaUrl` é **substituída** pela rota do nosso proxy: a URL interna do WAHA
 * nunca pode aparecer em resposta pública.
 */
function toMessageResponse(mensagem: Message, sessionLabel: string | null): MessageResponse {
  return {
    id: mensagem.id,
    wahaId: mensagem.wahaId,
    sessionId: mensagem.sessionId,
    sessionLabel,
    direction: mensagem.direction as Direction,
    chatId: mensagem.chatId,
    phone: phoneFromChatId(mensagem.chatId),
    type: mensagem.type,
    body: mensagem.body,
    mediaUrl: mensagem.mediaUrl ? `/v1/media/${mensagem.id}` : null,
    mediaMimeType: mensagem.mediaMimeType,
    mediaSize: mensagem.mediaSize,
    status: mensagem.status as MessageStatus,
    ack: mensagem.ack,
    error: mensagem.error,
    sentByApiKeyId: mensagem.sentByApiKeyId,
    timestamp: mensagem.timestamp,
  };
}

function nomeDeArquivo(mensagem: Message): string {
  const extensoes: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'application/pdf': 'pdf',
  };

  const base = (mensagem.mediaMimeType ?? '').split(';')[0]?.trim() ?? '';
  const extensao = extensoes[base] ?? base.split('/')[1] ?? 'bin';

  return `${mensagem.id}.${extensao}`;
}

/** Escapa um campo para CSV. */
function csv(valor: string): string {
  const limpo = valor.replace(/\r?\n/g, ' ');
  return /[",;]/.test(limpo) ? `"${limpo.replace(/"/g, '""')}"` : limpo;
}
