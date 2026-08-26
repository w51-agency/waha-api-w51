import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { NotFoundError } from '../../common/errors/problem-details';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminGuard } from '../admin-auth/admin.guard';

import { WebhooksOutService } from './webhooks-out.service';

import type { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';

/**
 * Webhooks pela ótica do painel.
 *
 * As rotas `/v1/webhook-endpoints` operam no escopo da API key; o painel precisa
 * ver os de todas as aplicações e escolher a aplicação ao cadastrar.
 */
@ApiTags('Admin')
@ApiBearerAuth('BearerAuth')
@UseGuards(AdminGuard)
@Controller('admin/webhook-endpoints')
export class AdminWebhooksController {
  constructor(
    private readonly webhooks: WebhooksOutService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar endpoints de todas as aplicações' })
  @ApiQuery({ name: 'applicationId', required: false })
  async list(@Query('applicationId') applicationId?: string) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: applicationId ? { applicationId } : {},
      include: { application: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // O `secret` nunca sai daqui: só é exibido na criação e na rotação.
    return endpoints.map(({ secret: _secret, ...endpoint }) => endpoint);
  }

  @Post()
  @ApiOperation({ summary: 'Cadastrar um endpoint' })
  create(@Body() dto: CreateWebhookDto & { applicationId: string }) {
    return this.webhooks.create(dto.applicationId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar um endpoint' })
  async update(@Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    const endpoint = await this.buscar(id);
    return this.webhooks.update(id, endpoint.applicationId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover um endpoint' })
  async remove(@Param('id') id: string) {
    const endpoint = await this.buscar(id);
    return this.webhooks.remove(id, endpoint.applicationId);
  }

  @Post(':id/rotate-secret')
  @ApiOperation({ summary: 'Trocar o segredo de assinatura' })
  async rotateSecret(@Param('id') id: string) {
    const endpoint = await this.buscar(id);
    return this.webhooks.rotateSecret(id, endpoint.applicationId);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Enviar um evento de teste' })
  async test(@Param('id') id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { id },
      include: { application: { select: { id: true, slug: true } } },
    });

    if (!endpoint) throw new NotFoundError('Endpoint não encontrado.', 'endpoint-not-found');

    return this.webhooks.enviarTeste(id, endpoint.applicationId, endpoint.application);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'Histórico de entregas' })
  @ApiQuery({ name: 'status', required: false })
  async deliveries(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const endpoint = await this.buscar(id);
    return this.webhooks.listDeliveries(id, endpoint.applicationId, status, Number(limit ?? 50));
  }

  @Post('deliveries/:deliveryId/retry')
  @ApiOperation({ summary: 'Reenviar uma entrega' })
  async retry(@Param('deliveryId') deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: { select: { applicationId: true } } },
    });

    if (!delivery) throw new NotFoundError('Entrega não encontrada.', 'delivery-not-found');

    return this.webhooks.retryDelivery(deliveryId, delivery.endpoint.applicationId);
  }

  private async buscar(id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!endpoint) throw new NotFoundError('Endpoint não encontrado.', 'endpoint-not-found');
    return endpoint;
  }
}
