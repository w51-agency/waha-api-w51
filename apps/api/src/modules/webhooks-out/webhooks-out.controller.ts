import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { CurrentApplication } from '../../common/decorators/current-app.decorator';
import { Scopes } from '../../common/decorators/scopes.decorator';

import {
  CreatedWebhookResponse,
  CreateWebhookDto,
  DeliveryResponse,
  UpdateWebhookDto,
  WebhookResponse,
} from './dto/webhook.dto';
import { WebhooksOutService } from './webhooks-out.service';

import type { AuthenticatedApiKey } from '../api-keys/api-key.types';

@ApiTags('Webhooks')
@ApiSecurity('ApiKeyAuth')
@Controller('v1/webhook-endpoints')
export class WebhooksOutController {
  constructor(private readonly webhooks: WebhooksOutService) {}

  @Post()
  @Scopes('webhooks:manage')
  @ApiOperation({
    summary: 'Cadastrar um endpoint',
    description:
      'Registre a URL do seu sistema para receber eventos das **suas** sessões.\n\n' +
      'Cada entrega leva o header `X-Gateway-Signature: t=<unix>,v1=<hmac>`, onde o ' +
      'HMAC-SHA256 cobre `"{t}.{corpo}"` — o timestamp entra no que é assinado ' +
      'justamente para que você possa recusar entregas antigas.\n\n' +
      'Responda 2xx rapidamente e processe de forma assíncrona: entregas que demoram ' +
      'mais que o tempo limite são retentadas.',
  })
  @ApiOkResponse({ type: CreatedWebhookResponse })
  create(
    @Body() dto: CreateWebhookDto,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
  ): Promise<CreatedWebhookResponse> {
    return this.webhooks.create(app.id, dto);
  }

  @Get()
  @Scopes('webhooks:manage')
  @ApiOperation({ summary: 'Listar seus endpoints' })
  @ApiOkResponse({ type: [WebhookResponse] })
  list(@CurrentApplication() app: AuthenticatedApiKey['application']): Promise<WebhookResponse[]> {
    return this.webhooks.list(app.id);
  }

  @Get(':id')
  @Scopes('webhooks:manage')
  @ApiOperation({ summary: 'Detalhe de um endpoint' })
  findOne(
    @Param('id') id: string,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
  ): Promise<WebhookResponse> {
    return this.webhooks.findOne(id, app.id);
  }

  @Patch(':id')
  @Scopes('webhooks:manage')
  @ApiOperation({
    summary: 'Editar um endpoint',
    description:
      'Enviar `active: true` reativa um endpoint que foi desligado automaticamente ' +
      'por falhas seguidas, zerando o contador.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
  ): Promise<WebhookResponse> {
    return this.webhooks.update(id, app.id, dto);
  }

  @Delete(':id')
  @Scopes('webhooks:manage')
  @ApiOperation({ summary: 'Remover um endpoint' })
  remove(@Param('id') id: string, @CurrentApplication() app: AuthenticatedApiKey['application']) {
    return this.webhooks.remove(id, app.id);
  }

  @Post(':id/rotate-secret')
  @Scopes('webhooks:manage')
  @ApiOperation({
    summary: 'Trocar o segredo de assinatura',
    description: 'O segredo anterior deixa de valer imediatamente.',
  })
  rotateSecret(
    @Param('id') id: string,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
  ): Promise<CreatedWebhookResponse> {
    return this.webhooks.rotateSecret(id, app.id);
  }

  @Post(':id/test')
  @Scopes('webhooks:manage')
  @ApiOperation({
    summary: 'Enviar um evento de teste',
    description: 'Dispara um evento `ping` para conferir a configuração do seu endpoint.',
  })
  test(@Param('id') id: string, @CurrentApplication() app: AuthenticatedApiKey['application']) {
    return this.webhooks.enviarTeste(id, app.id, app);
  }

  @Get(':id/deliveries')
  @Scopes('webhooks:manage')
  @ApiOperation({
    summary: 'Histórico de entregas',
    description: 'Cada tentativa é registrada, com código HTTP, duração e erro.',
  })
  @ApiQuery({ name: 'status', required: false, example: 'FAILED' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ type: [DeliveryResponse] })
  deliveries(
    @Param('id') id: string,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<DeliveryResponse[]> {
    return this.webhooks.listDeliveries(id, app.id, status, Number(limit ?? 50));
  }
}

@ApiTags('Webhooks')
@ApiSecurity('ApiKeyAuth')
@Controller('v1/webhook-deliveries')
export class WebhookDeliveriesController {
  constructor(private readonly webhooks: WebhooksOutService) {}

  @Post(':id/retry')
  @Scopes('webhooks:manage')
  @ApiOperation({ summary: 'Reenviar uma entrega' })
  retry(@Param('id') id: string, @CurrentApplication() app: AuthenticatedApiKey['application']) {
    return this.webhooks.retryDelivery(id, app.id);
  }
}
