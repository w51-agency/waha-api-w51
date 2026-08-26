import { Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import type { WahaWebhookEvent } from '@gateway/shared';

import { Public } from '../../common/decorators/public.decorator';
import { UnauthorizedError } from '../../common/errors/problem-details';
import { AppConfig } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';

import { WebhookIngestService } from './webhook-ingest.service';
import { timestampDentroDaJanela, verificarAssinaturaWaha } from './webhook-signature';

import type { Request } from 'express';

/**
 * Recebe os eventos do WAHA.
 *
 * Excluído do Swagger de propósito: publicar o endpoint interno seria entregar
 * mapa da superfície de ataque. Não usa API key — a autenticação é a assinatura
 * HMAC, verificada contra o segredo próprio de cada sessão.
 *
 * Fora do rate limit: em uma rajada (sincronização inicial de histórico, por
 * exemplo) o WAHA entrega muitos eventos seguidos, e barrá-los provocaria
 * retentativas em cascata do lado dele.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('internal/waha')
export class WebhookIngestController {
  private readonly logger = new Logger(WebhookIngestController.name);

  constructor(
    private readonly ingest: WebhookIngestService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receber(
    @Req() request: Request,
    @Headers('x-webhook-hmac') assinatura?: string,
    @Headers('x-webhook-hmac-algorithm') algoritmo?: string,
    @Headers('x-webhook-timestamp') timestamp?: string,
  ): Promise<{ status: string }> {
    const evento = request.body as WahaWebhookEvent;

    if (!evento?.id || !evento.event) {
      throw new UnauthorizedError('Evento malformado.', 'malformed-event');
    }

    await this.autenticar(request, evento, assinatura, algoritmo, timestamp);

    const resultado = await this.ingest.processar(evento);

    return { status: resultado };
  }

  /**
   * Autentica o evento pela assinatura HMAC.
   *
   * O segredo é o da própria sessão (gerado na tarefa 09), não um global: assim
   * o comprometimento de uma sessão não permite forjar eventos das outras. O
   * segredo global existe só como alternativa, para sessões criadas fora do
   * gateway.
   */
  private async autenticar(
    request: Request,
    evento: WahaWebhookEvent,
    assinatura?: string,
    algoritmo?: string,
    timestamp?: string,
  ): Promise<void> {
    const janela = timestampDentroDaJanela(timestamp, this.config.get('WEBHOOK_TOLERANCE_SECONDS'));

    if (!janela.valida) {
      this.logger.warn(`Evento ${evento.id} recusado: ${janela.motivo}`);
      throw new UnauthorizedError('Evento fora da janela de tempo aceita.', 'stale-event');
    }

    const session = await this.prisma.session.findUnique({
      where: { name: evento.session },
      select: { webhookSecret: true },
    });

    const segredo = session?.webhookSecret ?? this.config.get('WAHA_WEBHOOK_HMAC_KEY');

    // O corpo bruto é indispensável: o HMAC cobre os bytes exatos recebidos, e
    // reserializar o JSON alteraria ordem de chaves ou espaçamento.
    const verificacao = verificarAssinaturaWaha(
      request.rawBody,
      assinatura,
      segredo,
      (algoritmo ?? 'sha512').toLowerCase(),
    );

    if (!verificacao.valida) {
      this.logger.warn(
        `Assinatura inválida no evento ${evento.id} (${evento.event}): ${verificacao.motivo}`,
      );
      throw new UnauthorizedError('Assinatura inválida.', 'invalid-signature');
    }
  }
}
