import { Injectable, Logger } from '@nestjs/common';

import { generateSecret } from '../../common/crypto/api-key.crypto';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/problem-details';
import { AppConfig } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUrlDeMidiaSegura } from '../messages/media-source';

import { assinaturaCobreEvento, type GatewayEvent, type GatewayEventEnvelope } from './events';
import { novoEventoId, WebhookDeliveryQueue } from './webhook-delivery.queue';

import type {
  CreatedWebhookResponse,
  CreateWebhookDto,
  DeliveryResponse,
  UpdateWebhookDto,
  WebhookResponse,
} from './dto/webhook.dto';
import type { Session, WebhookEndpoint } from '../../generated/prisma/client';

const MAX_ENDPOINTS_POR_APP = 10;

@Injectable()
export class WebhooksOutService {
  private readonly logger = new Logger(WebhooksOutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: WebhookDeliveryQueue,
    private readonly config: AppConfig,
  ) {}

  // ===========================================================================
  //  CRUD
  // ===========================================================================

  async create(applicationId: string, dto: CreateWebhookDto): Promise<CreatedWebhookResponse> {
    await this.validarUrl(dto.url);

    const total = await this.prisma.webhookEndpoint.count({ where: { applicationId } });
    if (total >= MAX_ENDPOINTS_POR_APP) {
      throw new ConflictError(
        `Limite de ${MAX_ENDPOINTS_POR_APP} endpoints por aplicação atingido.`,
        'endpoint-limit',
      );
    }

    const secret = generateSecret(32);

    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        applicationId,
        url: dto.url,
        secret,
        events: dto.events ?? ['*'],
        description: dto.description ?? null,
      },
    });

    return {
      ...toWebhookResponse(endpoint),
      secret,
      warning:
        'Guarde este segredo agora — ele não será exibido novamente. ' +
        'Use-o para verificar a assinatura das entregas (veja /docs).',
    };
  }

  async list(applicationId: string): Promise<WebhookResponse[]> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });

    return endpoints.map(toWebhookResponse);
  }

  async findOne(id: string, applicationId: string): Promise<WebhookResponse> {
    return toWebhookResponse(await this.buscarProprio(id, applicationId));
  }

  async update(id: string, applicationId: string, dto: UpdateWebhookDto): Promise<WebhookResponse> {
    await this.buscarProprio(id, applicationId);

    if (dto.url) await this.validarUrl(dto.url);

    const atualizado = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.events !== undefined ? { events: dto.events } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        // Reativar zera o contador e limpa o motivo — senão o endpoint seria
        // desligado de novo na primeira falha.
        ...(dto.active === true
          ? { active: true, consecutiveFailures: 0, disabledAt: null, disabledReason: null }
          : {}),
        ...(dto.active === false ? { active: false } : {}),
      },
    });

    return toWebhookResponse(atualizado);
  }

  async remove(id: string, applicationId: string): Promise<{ deleted: true }> {
    await this.buscarProprio(id, applicationId);
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    return { deleted: true };
  }

  async rotateSecret(id: string, applicationId: string): Promise<CreatedWebhookResponse> {
    await this.buscarProprio(id, applicationId);

    const secret = generateSecret(32);
    const atualizado = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: { secret },
    });

    return {
      ...toWebhookResponse(atualizado),
      secret,
      warning:
        'Segredo anterior invalidado. As próximas entregas usarão este — ' +
        'atualize o seu sistema antes que cheguem.',
    };
  }

  // ===========================================================================
  //  Entregas
  // ===========================================================================

  async listDeliveries(
    endpointId: string,
    applicationId: string,
    status?: string,
    limit = 50,
  ): Promise<DeliveryResponse[]> {
    await this.buscarProprio(endpointId, applicationId);

    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: { endpointId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });

    return deliveries.map((d) => ({
      id: d.id,
      eventType: d.eventType,
      status: d.status,
      attempts: d.attempts,
      responseStatus: d.responseStatus,
      responseBody: d.responseBody,
      error: d.error,
      durationMs: d.durationMs,
      nextRetryAt: d.nextRetryAt,
      deliveredAt: d.deliveredAt,
      createdAt: d.createdAt,
    }));
  }

  async retryDelivery(deliveryId: string, applicationId: string): Promise<{ queued: true }> {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, endpoint: { applicationId } },
    });

    if (!delivery) throw new NotFoundError('Entrega não encontrada.', 'delivery-not-found');

    await this.fila.reenfileirar(deliveryId);

    return { queued: true };
  }

  /** Dispara um evento sintético, para o integrador conferir a configuração. */
  async enviarTeste(
    id: string,
    applicationId: string,
    application: { id: string; slug: string },
  ): Promise<{ deliveryId: string }> {
    const endpoint = await this.buscarProprio(id, applicationId);

    const envelope: GatewayEventEnvelope = {
      id: novoEventoId(),
      type: 'ping',
      createdAt: new Date().toISOString(),
      application,
      session: null,
      data: {
        mensagem: 'Se você está lendo isto, seu endpoint está configurado corretamente.',
        verificacao:
          'Confira o header X-Gateway-Signature usando o segredo deste endpoint. ' +
          'O exemplo de verificação está em /docs.',
      },
    };

    const deliveryId = await this.fila.enfileirar(
      endpoint.id,
      endpoint.url,
      endpoint.secret,
      envelope,
    );

    return { deliveryId };
  }

  // ===========================================================================
  //  Publicação
  // ===========================================================================

  /**
   * Publica um evento aos endpoints da aplicação.
   *
   * Chamado pela ingestão (tarefa 10) e pelo envio (tarefa 11). Falha aqui
   * **nunca** propaga: o repasse é secundário em relação a registrar o evento,
   * e derrubar a ingestão por causa de um webhook seria trocar um problema
   * pequeno por um grande.
   */
  async publicar(
    applicationId: string,
    tipo: GatewayEvent,
    dados: unknown,
    session?: Pick<Session, 'id' | 'label' | 'phoneNumber'> | null,
  ): Promise<void> {
    try {
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: { applicationId, active: true },
      });

      if (endpoints.length === 0) return;

      const application = await this.prisma.application.findUnique({
        where: { id: applicationId },
        select: { id: true, slug: true },
      });

      if (!application) return;

      const envelope: GatewayEventEnvelope = {
        id: novoEventoId(),
        type: tipo,
        createdAt: new Date().toISOString(),
        application,
        session: session
          ? { id: session.id, label: session.label, phoneNumber: session.phoneNumber }
          : null,
        data: dados,
      };

      await Promise.all(
        endpoints
          .filter((e) => assinaturaCobreEvento(e.events, tipo))
          .map((e) => this.fila.enfileirar(e.id, e.url, e.secret, envelope)),
      );
    } catch (erro) {
      this.logger.warn(`Falha ao publicar ${tipo}: ${String(erro)}`);
    }
  }

  // ===========================================================================
  //  Apoio
  // ===========================================================================

  private async buscarProprio(id: string, applicationId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, applicationId },
    });

    if (!endpoint) throw new NotFoundError('Endpoint não encontrado.', 'endpoint-not-found');

    return endpoint;
  }

  /**
   * Valida a URL do endpoint.
   *
   * A mesma proteção anti-SSRF do envio de mídia: a URL vem de fora e é chamada
   * de dentro da nossa rede. Em produção exigimos HTTPS, porque o payload
   * carrega conteúdo de conversas.
   */
  private async validarUrl(url: string): Promise<void> {
    const modoDesenvolvimento = this.config.get('ALLOW_INSECURE_WEBHOOKS');

    // Em desenvolvimento o receptor de teste roda em localhost, então a
    // checagem de endereço interno precisa ceder. Em produção ela vale — um
    // endpoint apontando para a rede interna transformaria o gateway em ponte
    // para recursos que o integrador não deveria alcançar.
    const parsed = await assertUrlDeMidiaSegura(url, {
      permitirEnderecoInterno: modoDesenvolvimento,
    });

    if (parsed.protocol === 'http:' && !modoDesenvolvimento) {
      throw new ValidationError(
        'Endpoints de webhook precisam usar HTTPS: o payload contém conteúdo de conversas. ' +
          'Para permitir http:// em desenvolvimento, defina ALLOW_INSECURE_WEBHOOKS=true.',
      );
    }
  }
}

function toWebhookResponse(endpoint: WebhookEndpoint): WebhookResponse {
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    active: endpoint.active,
    description: endpoint.description,
    consecutiveFailures: endpoint.consecutiveFailures,
    disabledAt: endpoint.disabledAt,
    disabledReason: endpoint.disabledReason,
    createdAt: endpoint.createdAt,
  };
}
