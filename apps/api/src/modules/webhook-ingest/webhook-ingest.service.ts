import { Injectable, Logger } from '@nestjs/common';

import type {
  WahaMessage,
  WahaMessageAckPayload,
  WahaSessionStatusPayload,
  WahaWebhookEvent,
} from '@gateway/shared';
import {
  ACK_TO_STATUS,
  Direction,
  MESSAGE_STATUS_RANK,
  MessageStatus,
  SessionStatus,
} from '@gateway/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { mapStatus } from '../sessions/sessions.service';
import { EventsBus } from '../events/events.bus';
import { WebhooksOutService } from '../webhooks-out/webhooks-out.service';

import type { Session } from '../../generated/prisma/client';

export type ResultadoIngestao = 'processado' | 'duplicado' | 'ignorado';

/**
 * Processa os eventos entregues pelo WAHA.
 *
 * Este é o serviço mais crítico do sistema: é aqui que o vínculo número ↔
 * aplicação se fecha, e é por aqui que passa todo o histórico de mensagens.
 *
 * Três garantias:
 *
 * 1. **Idempotência.** O WAHA retenta até 15 vezes. Sem a trava, uma mensagem
 *    recebida durante uma instabilidade viraria 15 registros.
 * 2. **Nenhum handler derruba a ingestão.** Um evento desconhecido, ou um que
 *    falhe, é registrado e ignorado — não pode travar a fila de eventos.
 * 3. **Status de mensagem nunca regride.** Webhooks de ack chegam fora de ordem;
 *    sem a comparação de ordem, uma mensagem já lida voltaria para "enviada".
 */
@Injectable()
export class WebhookIngestService {
  private readonly logger = new Logger(WebhookIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksOutService,
    private readonly bus: EventsBus,
  ) {}

  async processar(evento: WahaWebhookEvent): Promise<ResultadoIngestao> {
    // A trava vem primeiro: se a inserção colidir, o evento já foi tratado.
    const novo = await this.registrarEvento(evento);
    if (!novo) {
      this.logger.debug(`Evento ${evento.id} já processado — ignorando reentrega`);
      return 'duplicado';
    }

    const session = await this.resolverSessao(evento);
    if (!session) {
      // Sessão criada fora do gateway, ou já excluída. Não é erro.
      this.logger.debug(
        `Evento ${evento.event} para sessão desconhecida "${evento.session}" — ignorado`,
      );
      return 'ignorado';
    }

    try {
      await this.despachar(evento, session);
      return 'processado';
    } catch (erro) {
      // Já registramos o evento, então não haverá reentrega. Falhar aqui é
      // perder o evento — mas devolver erro faria o WAHA retentar contra a
      // trava de idempotência, gastando 15 tentativas sem efeito.
      this.logger.error(
        { err: erro, eventId: evento.id, event: evento.event },
        `Falha ao processar ${evento.event}: ${String(erro)}`,
      );
      return 'ignorado';
    }
  }

  /** Devolve `false` quando o evento já havia sido registrado. */
  private async registrarEvento(evento: WahaWebhookEvent): Promise<boolean> {
    try {
      await this.prisma.inboundEvent.create({
        data: {
          wahaEventId: evento.id,
          eventType: evento.event,
          sessionName: evento.session,
        },
      });
      return true;
    } catch {
      // Violação de unicidade em wahaEventId — exatamente o que queremos.
      return false;
    }
  }

  /**
   * Localiza a sessão do evento.
   *
   * Prefere o `gateway.session.id` carimbado no `config.metadata` (tarefa 09):
   * é direto e sobrevive a renomeações. O nome da sessão é a alternativa.
   */
  private async resolverSessao(evento: WahaWebhookEvent): Promise<Session | null> {
    const sessionId = evento.metadata?.['gateway.session.id'];

    if (sessionId) {
      const porId = await this.prisma.session.findUnique({ where: { id: sessionId } });
      if (porId) return porId;
    }

    return this.prisma.session.findUnique({ where: { name: evento.session } });
  }

  private async despachar(evento: WahaWebhookEvent, session: Session): Promise<void> {
    switch (evento.event) {
      case 'session.status':
      case 'state.change':
        return this.aoMudarStatus(evento as WahaWebhookEvent<WahaSessionStatusPayload>, session);

      case 'message':
      case 'message.any':
        return this.aoReceberMensagem(evento as WahaWebhookEvent<WahaMessage>, session);

      case 'message.ack':
        return this.aoConfirmar(evento as WahaWebhookEvent<WahaMessageAckPayload>, session);

      case 'message.revoked':
        return this.aoRevogar(evento, session);

      case 'engine.event':
        this.logger.debug(`engine.event em ${session.name}`);
        return;

      default:
        // Eventos que ainda não têm tratamento próprio (grupos, presença,
        // enquetes, chamadas) são registrados e repassados ao integrador pela
        // tarefa 13. Um evento novo do WAHA nunca derruba a ingestão.
        this.logger.debug(`Evento ${evento.event} sem tratamento próprio — apenas registrado`);
        return;
    }
  }

  // ===========================================================================
  //  session.status — o evento mais importante do sistema
  // ===========================================================================

  /**
   * Atualiza o estado da sessão e, em `WORKING`, **grava o número**.
   *
   * É aqui que o requisito central se completa: a sessão já sabe qual aplicação
   * e qual chave pediram o QR (tarefa 09); este evento traz o `me.id` e fecha o
   * vínculo com o número real.
   */
  private async aoMudarStatus(
    evento: WahaWebhookEvent<WahaSessionStatusPayload>,
    session: Session,
  ): Promise<void> {
    const status = mapStatus(evento.payload?.status ?? '');
    const agora = new Date();

    const dados: Record<string, unknown> = { status, lastStatusAt: agora };

    if (status === SessionStatus.WORKING) {
      const me = evento.me;

      if (me?.id) {
        dados.waId = me.id;
        // "5511999999999@c.us" -> "5511999999999"
        dados.phoneNumber = me.id.split('@')[0] ?? null;
        dados.pushName = me.pushName ?? null;
      }

      if (!session.connectedAt) dados.connectedAt = agora;
      dados.disconnectedAt = null;

      this.logger.log(
        `Sessão ${session.name} conectada` +
          (me?.id ? ` ao número ${me.id.split('@')[0]}` : ' (sem me.id no evento)'),
      );
    }

    if (status === SessionStatus.STOPPED || status === SessionStatus.FAILED) {
      if (session.status === SessionStatus.WORKING) dados.disconnectedAt = agora;
      this.logger.warn(`Sessão ${session.name} mudou para ${status}`);
    }

    const atualizada = await this.prisma.session.update({
      where: { id: session.id },
      data: dados as never,
    });

    // Repasse ao integrador. `publicar` nunca propaga erro: o repasse é
    // secundário em relação a ter registrado o evento.
    await this.webhooks.publicar(session.applicationId, 'session.status', { status }, atualizada);

    // Barramento interno: alimenta o SSE do painel e o do integrador.
    this.bus.publicar({
      type: 'session.status',
      applicationId: session.applicationId,
      sessionId: session.id,
      data: {
        status,
        phoneNumber: atualizada.phoneNumber,
        pushName: atualizada.pushName,
        label: atualizada.label,
      },
    });

    if (status === SessionStatus.WORKING && session.status !== SessionStatus.WORKING) {
      await this.webhooks.publicar(
        session.applicationId,
        'session.connected',
        { phoneNumber: atualizada.phoneNumber, pushName: atualizada.pushName },
        atualizada,
      );
    }

    if (
      (status === SessionStatus.STOPPED || status === SessionStatus.FAILED) &&
      session.status === SessionStatus.WORKING
    ) {
      await this.webhooks.publicar(
        session.applicationId,
        'session.disconnected',
        { status },
        atualizada,
      );
    }
  }

  // ===========================================================================
  //  Mensagens
  // ===========================================================================

  private async aoReceberMensagem(
    evento: WahaWebhookEvent<WahaMessage>,
    session: Session,
  ): Promise<void> {
    const payload = evento.payload;
    if (!payload?.id) return;

    const fromMe = payload.fromMe === true;
    const chatId = fromMe ? (payload.to ?? payload.from) : payload.from;
    if (!chatId) return;

    const midia = payload.media ?? null;

    // Upsert em vez de create: `message` e `message.any` podem trazer a mesma
    // mensagem, e um envio nosso já pode ter o registro criado pela tarefa 11.
    const registro = await this.prisma.message.upsert({
      where: { sessionId_wahaId: { sessionId: session.id, wahaId: payload.id } },
      create: {
        applicationId: session.applicationId,
        sessionId: session.id,
        wahaId: payload.id,
        direction: fromMe ? Direction.OUTBOUND : Direction.INBOUND,
        chatId,
        fromMe,
        type: tipoDaMensagem(payload),
        body: truncar(payload.body),
        mediaUrl: midia?.url ?? null,
        mediaMimeType: midia?.mimetype ?? null,
        ack: typeof payload.ack === 'number' ? payload.ack : null,
        ackName: payload.ackName ?? null,
        status: fromMe ? MessageStatus.SENT : MessageStatus.DELIVERED,
        timestamp: paraData(payload.timestamp),
        raw: payload as never,
      },
      update: {
        // Numa reentrega só faz sentido enriquecer o que pode ter chegado
        // depois; nunca sobrescrever o que já sabemos.
        ...(midia?.url ? { mediaUrl: midia.url, mediaMimeType: midia.mimetype ?? null } : {}),
        raw: payload as never,
      },
    });

    this.bus.publicar({
      type: fromMe ? 'message.sent' : 'message.received',
      applicationId: session.applicationId,
      sessionId: session.id,
      data: { id: registro.id, chatId, type: registro.type, body: registro.body },
    });

    await this.webhooks.publicar(
      session.applicationId,
      fromMe ? 'message.sent' : 'message.received',
      {
        id: registro.id,
        chatId,
        from: payload.from,
        type: registro.type,
        body: registro.body,
        // A mídia é referenciada pelo nosso proxy, nunca pela URL interna do WAHA.
        mediaUrl: registro.mediaUrl ? `/v1/media/${registro.id}` : null,
        mediaMimeType: registro.mediaMimeType,
        timestamp: registro.timestamp.toISOString(),
      },
      session,
    );
  }

  /**
   * Aplica uma confirmação de entrega, **sem deixar o status regredir**.
   *
   * Os webhooks de ack não chegam em ordem garantida. Sem a comparação de
   * ordem, um `ack=1` (servidor) atrasado sobrescreveria um `ack=3` (lida) já
   * aplicado, e o painel mostraria a mensagem voltando no tempo.
   */
  private async aoConfirmar(
    evento: WahaWebhookEvent<WahaMessageAckPayload>,
    session: Session,
  ): Promise<void> {
    const payload = evento.payload;
    if (!payload?.id) return;

    const mensagem = await this.prisma.message.findUnique({
      where: { sessionId_wahaId: { sessionId: session.id, wahaId: payload.id } },
    });

    if (!mensagem) {
      this.logger.debug(`Ack para mensagem desconhecida ${payload.id} — ignorado`);
      return;
    }

    const novoStatus = ACK_TO_STATUS[payload.ack] ?? null;
    if (!novoStatus) return;

    const atual = MESSAGE_STATUS_RANK[mensagem.status as MessageStatus] ?? 0;
    const proposto = MESSAGE_STATUS_RANK[novoStatus] ?? 0;

    // FAILED (rank -1) sempre vence: é informação nova e definitiva.
    const deveAtualizar = novoStatus === MessageStatus.FAILED || proposto > atual;

    await this.prisma.message.update({
      where: { id: mensagem.id },
      data: {
        ack: payload.ack,
        ackName: payload.ackName ?? null,
        ...(deveAtualizar ? { status: novoStatus } : {}),
      },
    });

    if (deveAtualizar) {
      await this.webhooks.publicar(
        session.applicationId,
        'message.ack',
        {
          id: mensagem.id,
          chatId: mensagem.chatId,
          ack: payload.ack,
          ackName: payload.ackName ?? null,
          status: novoStatus,
        },
        session,
      );
    }
  }

  private async aoRevogar(evento: WahaWebhookEvent, session: Session): Promise<void> {
    const payload = evento.payload as { id?: string; before?: { id?: string } } | undefined;
    const wahaId = payload?.before?.id ?? payload?.id;
    if (!wahaId) return;

    await this.prisma.message
      .update({
        where: { sessionId_wahaId: { sessionId: session.id, wahaId } },
        data: { type: 'revoked', body: null },
      })
      .catch(() => undefined);
  }
}

// =============================================================================
//  Apoio
// =============================================================================

/**
 * Deriva o tipo da mensagem.
 *
 * O NOWEB nem sempre traz um campo `type` explícito, então inferimos pelo
 * mimetype da mídia — cair em "unknown" atrapalharia o filtro por tipo do painel.
 */
function tipoDaMensagem(payload: WahaMessage): string {
  const explicito = (payload as { type?: unknown }).type;
  if (typeof explicito === 'string' && explicito) return explicito;

  const mimetype = payload.media?.mimetype;
  if (!mimetype) return payload.hasMedia ? 'media' : 'text';

  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'document';
}

/** O WhatsApp usa segundos; JavaScript, milissegundos. */
function paraData(timestamp: unknown): Date {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return new Date();
  // Valores abaixo de 10^12 são segundos; acima, já são milissegundos.
  return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
}

const LIMITE_CORPO = 16_000;

function truncar(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  return body.length > LIMITE_CORPO ? `${body.slice(0, LIMITE_CORPO)}…` : body;
}
