import { randomUUID } from 'node:crypto';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';

import { DeliveryStatus } from '@gateway/shared';

import { AppConfig } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

import { assinarPayload } from './signature';

import type { GatewayEventEnvelope } from './events';

export const FILA_ENTREGAS = 'webhook-delivery';

interface TarefaEntrega {
  deliveryId: string;
  endpointId: string;
  url: string;
  secret: string;
  payload: GatewayEventEnvelope;
}

/**
 * Entrega assíncrona dos webhooks de saída.
 *
 * **Nunca síncrona.** O endpoint do integrador pode estar lento ou fora do ar;
 * segurar a ingestão do WAHA esperando por ele faria o próprio WAHA considerar
 * a nossa resposta uma falha e retentar — uma cascata que multiplica o problema.
 *
 * O backoff é exponencial **com jitter**: sem a aleatoriedade, todas as entregas
 * que falharam durante uma indisponibilidade voltam no mesmo instante quando o
 * destino se recupera, e o derrubam de novo.
 */
@Injectable()
export class WebhookDeliveryQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryQueue.name);

  private queue!: Queue<TarefaEntrega>;
  private worker!: Worker<TarefaEntrega>;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    const connection = this.redis.client;

    this.queue = new Queue<TarefaEntrega>(FILA_ENTREGAS, { connection });

    this.worker = new Worker<TarefaEntrega>(FILA_ENTREGAS, (job) => this.entregar(job), {
      connection,
      concurrency: 10,
      settings: {
        // Estratégia própria: escala fixa (5s, 30s, 2min, 10min, 1h, 6h) com
        // jitter. Sem registrá-la aqui, o `backoff.type` declarado no job
        // seria ignorado em silêncio e o BullMQ usaria o padrão.
        backoffStrategy: (tentativas: number) => backoffMs(tentativas),
      },
    });

    this.worker.on('failed', (job, erro) => {
      if (!job) return;
      void this.aoFalhar(job, erro);
    });

    this.logger.log('Fila de entrega de webhooks iniciada');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Enfileira uma entrega e cria o registro correspondente. */
  async enfileirar(
    endpointId: string,
    url: string,
    secret: string,
    payload: GatewayEventEnvelope,
  ): Promise<string> {
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        endpointId,
        eventId: payload.id,
        eventType: payload.type,
        payload: payload as never,
        status: DeliveryStatus.PENDING,
      },
    });

    await this.queue.add(
      payload.type,
      { deliveryId: delivery.id, endpointId, url, secret, payload },
      {
        attempts: this.config.get('WEBHOOK_MAX_ATTEMPTS'),
        backoff: { type: 'custom' },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86_400 },
      },
    );

    return delivery.id;
  }

  /** Reenvio manual de uma entrega já registrada. */
  async reenfileirar(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });

    if (!delivery) return;

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: DeliveryStatus.PENDING, nextRetryAt: null },
    });

    await this.queue.add(
      delivery.eventType,
      {
        deliveryId,
        endpointId: delivery.endpointId,
        url: delivery.endpoint.url,
        secret: delivery.endpoint.secret,
        payload: delivery.payload as unknown as GatewayEventEnvelope,
      },
      { attempts: this.config.get('WEBHOOK_MAX_ATTEMPTS') },
    );
  }

  // ===========================================================================
  //  Execução
  // ===========================================================================

  private async entregar(job: Job<TarefaEntrega>): Promise<void> {
    const { deliveryId, url, secret, payload } = job.data;
    const tentativa = job.attemptsMade + 1;

    const corpo = JSON.stringify(payload);
    const { header } = assinarPayload(corpo, secret);

    const inicio = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.get('WEBHOOK_TIMEOUT_MS'));

    try {
      const resposta = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'WhatsAppGatewayW51/1.0',
          'x-gateway-signature': header,
          'x-gateway-event': payload.type,
          'x-gateway-event-id': payload.id,
          'x-gateway-delivery-id': deliveryId,
          'x-gateway-attempt': String(tentativa),
        },
        body: corpo,
        signal: controller.signal,
      });

      const texto = await resposta.text().catch(() => '');
      const duracao = Date.now() - inicio;

      if (!resposta.ok) {
        await this.registrarTentativa(deliveryId, tentativa, {
          responseStatus: resposta.status,
          responseBody: texto.slice(0, 2000),
          durationMs: duracao,
          status: DeliveryStatus.RETRYING,
        });

        throw new Error(`HTTP ${resposta.status}`);
      }

      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: DeliveryStatus.SUCCESS,
          attempts: tentativa,
          responseStatus: resposta.status,
          responseBody: texto.slice(0, 2000),
          durationMs: duracao,
          deliveredAt: new Date(),
          error: null,
        },
      });

      // Sucesso zera o contador: o endpoint só é desligado por falhas
      // *consecutivas*, não por falhas acumuladas ao longo de meses.
      await this.prisma.webhookEndpoint.update({
        where: { id: job.data.endpointId },
        data: { consecutiveFailures: 0 },
      });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);

      await this.registrarTentativa(deliveryId, tentativa, {
        error: motivo.slice(0, 1000),
        durationMs: Date.now() - inicio,
        status: DeliveryStatus.RETRYING,
      });

      throw erro;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Chamado quando o BullMQ esgota as tentativas. */
  private async aoFalhar(job: Job<TarefaEntrega>, erro: Error): Promise<void> {
    const esgotou = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!esgotou) {
      // Ainda haverá retentativa: registra a próxima janela para o painel.
      await this.prisma.webhookDelivery
        .update({
          where: { id: job.data.deliveryId },
          data: {
            status: DeliveryStatus.RETRYING,
            nextRetryAt: new Date(Date.now() + backoffMs(job.attemptsMade)),
          },
        })
        .catch(() => undefined);
      return;
    }

    await this.prisma.webhookDelivery
      .update({
        where: { id: job.data.deliveryId },
        data: {
          status: DeliveryStatus.ABANDONED,
          error: erro.message.slice(0, 1000),
          nextRetryAt: null,
        },
      })
      .catch(() => undefined);

    await this.contabilizarFalha(job.data.endpointId, erro.message);
  }

  /**
   * Desliga o endpoint após falhas consecutivas demais.
   *
   * Um endpoint que some (domínio expirado, sistema desligado) geraria
   * retentativas indefinidamente, entupindo a fila e o log. Desligar com o
   * motivo registrado torna o problema visível no painel em vez de invisível na
   * fila — e o integrador reativa quando corrigir.
   */
  private async contabilizarFalha(endpointId: string, motivo: string): Promise<void> {
    const limite = this.config.get('WEBHOOK_FAILURE_THRESHOLD');

    const endpoint = await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { consecutiveFailures: { increment: 1 } },
    });

    if (endpoint.consecutiveFailures >= limite && endpoint.active) {
      await this.prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: {
          active: false,
          disabledAt: new Date(),
          disabledReason:
            `Desativado automaticamente após ${endpoint.consecutiveFailures} falhas ` +
            `consecutivas. Último erro: ${motivo.slice(0, 200)}`,
        },
      });

      this.logger.warn(
        `Endpoint ${endpointId} desativado após ${endpoint.consecutiveFailures} falhas seguidas`,
      );
    }
  }

  private async registrarTentativa(
    deliveryId: string,
    tentativa: number,
    dados: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.webhookDelivery
      .update({ where: { id: deliveryId }, data: { attempts: tentativa, ...dados } as never })
      .catch(() => undefined);
  }
}

/** Backoff exponencial com jitter: 5s, 30s, 2min, 10min, 1h, 6h (aproximado). */
export function backoffMs(tentativa: number): number {
  const escala = [5_000, 30_000, 120_000, 600_000, 3_600_000, 21_600_000];
  const base = escala[Math.min(tentativa, escala.length - 1)] ?? 21_600_000;
  return base + Math.floor(Math.random() * base * 0.2);
}

export const novoEventoId = () => `gev_${randomUUID().replace(/-/g, '')}`;
