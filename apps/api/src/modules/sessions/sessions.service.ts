import { Injectable, Logger } from '@nestjs/common';
import { customAlphabet } from 'nanoid';

import { SESSION_STATUS_LABELS, SessionStatus, type WahaSessionStatus } from '@gateway/shared';

import { generateSecret } from '../../common/crypto/api-key.crypto';
import { ConflictError, NotFoundError } from '../../common/errors/problem-details';
import { AppConfig } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WahaClient } from '../waha/waha.client';
import { WahaSessionNotFoundError } from '../waha/waha.errors';

import type { CreateSessionDto, ListSessionsQuery, UpdateSessionDto } from './dto/session.dto';
import type { QrCodeResponse, SessionResponse } from './dto/session.response';
import type { Session } from '../../generated/prisma/client';
import type { AuthenticatedApiKey } from '../api-keys/api-key.types';
import type { Request } from 'express';

/** Alfabeto sem caracteres ambíguos — o nome aparece em log e em URL. */
const nanoid = customAlphabet('23456789abcdefghijkmnpqrstuvwxyz', 8);

/**
 * O QR do WhatsApp gira a cada ~20 segundos. Informar isso ao cliente é o que
 * evita que ele exiba um código morto e conclua que o sistema está quebrado.
 */
const QR_TTL_SEGUNDOS = 20;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  //  Criação — onde o rastreio de origem começa
  // ===========================================================================

  /**
   * Cria uma sessão e a registra no WAHA carimbada com a identidade de quem pediu.
   *
   * O `config.metadata` do WAHA aceita chaves arbitrárias e é devolvido **em todo
   * webhook**. Carimbar a identidade aqui é o que torna o rastreio confiável: cada
   * evento chega já sabendo de quem é, sem depender de tabela de correlação nem
   * da ordem de chegada.
   */
  async create(
    dto: CreateSessionDto,
    apiKey: AuthenticatedApiKey,
    request?: Request,
  ): Promise<SessionResponse> {
    const applicationId = apiKey.application.id;

    await this.assertDentroDoLimite(applicationId);

    if (dto.label) {
      const duplicado = await this.prisma.session.findFirst({
        where: { applicationId, label: dto.label },
      });
      if (duplicado) {
        throw new ConflictError(
          `Você já tem uma sessão com o apelido "${dto.label}".`,
          'duplicate-label',
        );
      }
    }

    // Nome técnico gerado por nós, nunca escolhido pelo integrador e nunca
    // reutilizado: o WAHA pode guardar estado residual de uma sessão excluída,
    // e reaproveitar o nome traria esse estado de volta.
    const name = `${apiKey.application.slug}--${nanoid()}`;
    const webhookSecret = generateSecret(32);

    // Gravamos localmente primeiro para ter o id que vai no metadata. Se o WAHA
    // recusar, apagamos — nada de registro fantasma.
    const session = await this.prisma.session.create({
      data: {
        applicationId,
        name,
        label: dto.label ?? null,
        status: SessionStatus.STARTING,
        engine: this.config.get('WHATSAPP_DEFAULT_ENGINE'),
        createdByApiKeyId: apiKey.id,
        createdVia: 'API',
        webhookSecret,
        meta: (dto.metadata ?? undefined) as never,
      },
    });

    try {
      await this.waha.createSession({
        name,
        start: true,
        config: {
          metadata: {
            'application.id': applicationId,
            'application.slug': apiKey.application.slug,
            'gateway.session.id': session.id,
            'created.by.apikey': apiKey.id,
          },
          // Sem o store, o motor NOWEB não dá acesso a chats, contatos nem
          // histórico — a tarefa 12 depende disto.
          noweb: { store: { enabled: true, fullSync: false } },
          webhooks: [
            {
              url: `${this.config.get('GATEWAY_INTERNAL_URL').replace(/\/+$/, '')}/internal/waha/webhook`,
              events: ['*'],
              hmac: { key: webhookSecret },
              retries: { policy: 'exponential', delaySeconds: 2, attempts: 15 },
            },
          ],
        },
      });
    } catch (erro) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      throw erro;
    }

    await this.audit.apiKey('session.created', {
      apiKeyId: apiKey.id,
      apiKeyLabel: `${apiKey.application.slug}/${apiKey.name}`,
      resourceType: 'session',
      resourceId: session.id,
      metadata: { name, label: dto.label ?? null },
      request,
    });

    return toSessionResponse(session);
  }

  // ===========================================================================
  //  QR — o registro de origem
  // ===========================================================================

  /**
   * Devolve o QR code e **registra quem pediu**.
   *
   * É o ponto exato do requisito: cada solicitação incrementa o contador, grava
   * o instante e deixa uma linha de auditoria com a chave de origem. Quando o
   * código for lido, o webhook `session.status = WORKING` fecha o vínculo com o
   * número — e a trilha completa fica disponível.
   */
  async getQr(
    sessionId: string,
    apiKey: AuthenticatedApiKey,
    request?: Request,
  ): Promise<QrCodeResponse> {
    const session = await this.findOwned(sessionId, apiKey.application.id);

    const atual = await this.sincronizarStatus(session);

    if (atual.status !== SessionStatus.SCAN_QR_CODE) {
      throw new ConflictError(mensagemQrIndisponivel(atual), 'qr-unavailable', {
        status: atual.status,
      });
    }

    const [{ value }, png] = await Promise.all([
      this.waha.getQrValue(session.name),
      this.waha.getQrImage(session.name),
    ]);

    await this.prisma.session.update({
      where: { id: session.id },
      data: { qrRequestCount: { increment: 1 }, lastQrRequestedAt: new Date() },
    });

    await this.audit.apiKey('session.qr.requested', {
      apiKeyId: apiKey.id,
      apiKeyLabel: `${apiKey.application.slug}/${apiKey.name}`,
      resourceType: 'session',
      resourceId: session.id,
      metadata: { sessionName: session.name, requestNumber: session.qrRequestCount + 1 },
      request,
    });

    return {
      value,
      imageBase64: png.toString('base64'),
      status: atual.status as SessionStatus,
      expiresInSeconds: QR_TTL_SEGUNDOS,
    };
  }

  /** Imagem PNG crua, para quem prefere consumir direto em uma tag `<img>`. */
  async getQrImage(
    sessionId: string,
    apiKey: AuthenticatedApiKey,
    request?: Request,
  ): Promise<Buffer> {
    const qr = await this.getQr(sessionId, apiKey, request);
    return Buffer.from(qr.imageBase64, 'base64');
  }

  async requestPairingCode(
    sessionId: string,
    phoneNumber: string,
    apiKey: AuthenticatedApiKey,
    request?: Request,
  ): Promise<{ code: string }> {
    const session = await this.findOwned(sessionId, apiKey.application.id);
    const atual = await this.sincronizarStatus(session);

    if (atual.status !== SessionStatus.SCAN_QR_CODE) {
      throw new ConflictError(mensagemQrIndisponivel(atual), 'pairing-unavailable');
    }

    const resultado = await this.waha.requestPairingCode(session.name, phoneNumber);

    await this.prisma.session.update({
      where: { id: session.id },
      data: { qrRequestCount: { increment: 1 }, lastQrRequestedAt: new Date() },
    });

    await this.audit.apiKey('session.pairing_code.requested', {
      apiKeyId: apiKey.id,
      apiKeyLabel: `${apiKey.application.slug}/${apiKey.name}`,
      resourceType: 'session',
      resourceId: session.id,
      // O número é o dado que faz a auditoria valer: registra qual telefone foi
      // alvo do pareamento.
      metadata: { phoneNumber },
      request,
    });

    return { code: resultado.code };
  }

  // ===========================================================================
  //  Consulta
  // ===========================================================================

  async list(applicationId: string, query: ListSessionsQuery): Promise<SessionResponse[]> {
    const sessions = await this.prisma.session.findMany({
      where: {
        applicationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { label: { contains: query.search, mode: 'insensitive' } },
                { phoneNumber: { contains: query.search } },
                { pushName: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return sessions.map(toSessionResponse);
  }

  async findOne(sessionId: string, applicationId: string): Promise<SessionResponse> {
    const session = await this.findOwned(sessionId, applicationId);
    return toSessionResponse(await this.sincronizarStatus(session));
  }

  async update(
    sessionId: string,
    applicationId: string,
    dto: UpdateSessionDto,
  ): Promise<SessionResponse> {
    const session = await this.findOwned(sessionId, applicationId);

    if (dto.label && dto.label !== session.label) {
      const duplicado = await this.prisma.session.findFirst({
        where: { applicationId, label: dto.label, id: { not: sessionId } },
      });
      if (duplicado) {
        throw new ConflictError(
          `Você já tem uma sessão com o apelido "${dto.label}".`,
          'duplicate-label',
        );
      }
    }

    const atualizada = await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.metadata !== undefined ? { meta: dto.metadata as never } : {}),
      },
    });

    return toSessionResponse(atualizada);
  }

  // ===========================================================================
  //  Ciclo de vida
  // ===========================================================================

  async start(sessionId: string, apiKey: AuthenticatedApiKey, request?: Request) {
    return this.acaoDeCiclo(sessionId, apiKey, 'start', request);
  }

  async stop(sessionId: string, apiKey: AuthenticatedApiKey, request?: Request) {
    return this.acaoDeCiclo(sessionId, apiKey, 'stop', request);
  }

  async restart(sessionId: string, apiKey: AuthenticatedApiKey, request?: Request) {
    return this.acaoDeCiclo(sessionId, apiKey, 'restart', request);
  }

  async logout(sessionId: string, apiKey: AuthenticatedApiKey, request?: Request) {
    return this.acaoDeCiclo(sessionId, apiKey, 'logout', request);
  }

  private async acaoDeCiclo(
    sessionId: string,
    apiKey: AuthenticatedApiKey,
    acao: 'start' | 'stop' | 'restart' | 'logout',
    request?: Request,
  ): Promise<SessionResponse> {
    const session = await this.findOwned(sessionId, apiKey.application.id);

    const metodos = {
      start: () => this.waha.startSession(session.name),
      stop: () => this.waha.stopSession(session.name),
      restart: () => this.waha.restartSession(session.name),
      logout: () => this.waha.logoutSession(session.name),
    };

    const resultado = await metodos[acao]();

    const dados: Record<string, unknown> = {
      status: mapStatus(resultado.status),
      lastStatusAt: new Date(),
    };

    // Logout desfaz o pareamento: o número deixa de estar vinculado, e manter os
    // campos preenchidos daria a impressão errada no painel.
    if (acao === 'logout') {
      Object.assign(dados, {
        phoneNumber: null,
        waId: null,
        pushName: null,
        connectedAt: null,
        disconnectedAt: new Date(),
      });
    }

    const atualizada = await this.prisma.session.update({
      where: { id: sessionId },
      data: dados as never,
    });

    await this.audit.apiKey(`session.${acao}`, {
      apiKeyId: apiKey.id,
      apiKeyLabel: `${apiKey.application.slug}/${apiKey.name}`,
      resourceType: 'session',
      resourceId: sessionId,
      request,
    });

    return toSessionResponse(atualizada);
  }

  async remove(
    sessionId: string,
    apiKey: AuthenticatedApiKey,
    request?: Request,
  ): Promise<{ deleted: true }> {
    const session = await this.findOwned(sessionId, apiKey.application.id);

    // Remover no WAHA antes: se a sessão sumir só daqui, ela fica órfã lá,
    // consumindo memória e mantendo o WhatsApp logado no aparelho do usuário.
    try {
      await this.waha.deleteSession(session.name);
    } catch (erro) {
      // Já ausente no WAHA não impede a limpeza local — é o estado desejado.
      if (!(erro instanceof WahaSessionNotFoundError)) throw erro;
      this.logger.warn(`Sessão ${session.name} já não existia no WAHA`);
    }

    await this.prisma.session.delete({ where: { id: sessionId } });

    await this.audit.apiKey('session.deleted', {
      apiKeyId: apiKey.id,
      apiKeyLabel: `${apiKey.application.slug}/${apiKey.name}`,
      resourceType: 'session',
      resourceId: sessionId,
      metadata: { name: session.name, phoneNumber: session.phoneNumber },
      request,
    });

    return { deleted: true };
  }

  // ===========================================================================
  //  Apoio
  // ===========================================================================

  /**
   * Busca a sessão garantindo que ela pertence à aplicação.
   *
   * Devolve **404, não 403**, quando é de outra aplicação: um 403 confirmaria
   * que o id existe, permitindo mapear as sessões alheias por tentativa.
   */
  private async findOwned(sessionId: string, applicationId: string): Promise<Session> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, applicationId },
    });

    if (!session) {
      throw new NotFoundError('Sessão não encontrada.', 'session-not-found');
    }

    return session;
  }

  /**
   * Alinha o status local com o do WAHA antes de decidir algo com base nele.
   *
   * Os webhooks são a fonte primária, mas podem se perder — se o gateway
   * estiver fora do ar no instante da mudança, o estado local fica defasado.
   * Consultar antes de operações que dependem do status evita recusar uma ação
   * legítima por causa de um dado velho.
   */
  private async sincronizarStatus(session: Session): Promise<Session> {
    try {
      const remota = await this.waha.getSession(session.name);
      const status = mapStatus(remota.status);

      if (status === session.status) return session;

      this.logger.debug(
        `Status de ${session.name} divergia: local=${session.status} remoto=${status}`,
      );

      return await this.prisma.session.update({
        where: { id: session.id },
        data: { status, lastStatusAt: new Date() },
      });
    } catch (erro) {
      if (erro instanceof WahaSessionNotFoundError) {
        return this.prisma.session.update({
          where: { id: session.id },
          data: { status: SessionStatus.FAILED, lastStatusAt: new Date() },
        });
      }
      // WAHA indisponível não deve derrubar uma leitura: devolvemos o que temos.
      this.logger.warn(`Não foi possível sincronizar ${session.name}: ${String(erro)}`);
      return session;
    }
  }

  private async assertDentroDoLimite(applicationId: string): Promise<void> {
    const limite = this.config.get('MAX_SESSIONS_PER_APP');
    if (limite === 0) return;

    const total = await this.prisma.session.count({ where: { applicationId } });
    if (total >= limite) {
      throw new ConflictError(
        `Limite de ${limite} sessões atingido para esta aplicação. ` +
          'Remova uma sessão existente antes de criar outra.',
        'session-limit-reached',
      );
    }
  }
}

// =============================================================================
//  Apoio de módulo
// =============================================================================

/** Status desconhecido vira UNKNOWN em vez de derrubar: o WAHA pode introduzir valores novos. */
export function mapStatus(status: WahaSessionStatus | string): SessionStatus {
  return (Object.values(SessionStatus) as string[]).includes(status)
    ? (status as SessionStatus)
    : SessionStatus.UNKNOWN;
}

export function toSessionResponse(session: Session): SessionResponse {
  return {
    id: session.id,
    label: session.label,
    status: session.status as SessionStatus,
    statusLabel: SESSION_STATUS_LABELS[session.status as SessionStatus] ?? 'Desconhecido',
    phoneNumber: session.phoneNumber,
    pushName: session.pushName,
    engine: session.engine,
    qrRequestCount: session.qrRequestCount,
    lastQrRequestedAt: session.lastQrRequestedAt,
    connectedAt: session.connectedAt,
    disconnectedAt: session.disconnectedAt,
    metadata: (session.meta ?? null) as Record<string, unknown> | null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function mensagemQrIndisponivel(session: Session): string {
  const rotulo = SESSION_STATUS_LABELS[session.status as SessionStatus] ?? session.status;

  if (session.status === SessionStatus.WORKING) {
    return `Esta sessão já está conectada${session.phoneNumber ? ` ao número ${session.phoneNumber}` : ''}. Para trocar de número, use /logout antes.`;
  }
  if (session.status === SessionStatus.STOPPED) {
    return 'Esta sessão está parada. Chame /start antes de solicitar o QR code.';
  }
  if (session.status === SessionStatus.STARTING) {
    return 'A sessão ainda está iniciando. Tente novamente em alguns segundos.';
  }
  if (session.status === SessionStatus.FAILED) {
    return 'A sessão falhou. Chame /restart para tentar novamente.';
  }
  return `QR code indisponível: a sessão está com status "${rotulo}".`;
}
