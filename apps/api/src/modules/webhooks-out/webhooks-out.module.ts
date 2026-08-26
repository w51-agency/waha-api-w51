import { Global, Module } from '@nestjs/common';

import { AdminWebhooksController } from './admin-webhooks.controller';
import { WebhookDeliveryQueue } from './webhook-delivery.queue';
import { WebhookDeliveriesController, WebhooksOutController } from './webhooks-out.controller';
import { WebhooksOutService } from './webhooks-out.service';

@Global()
@Module({
  controllers: [WebhooksOutController, WebhookDeliveriesController, AdminWebhooksController],
  providers: [WebhooksOutService, WebhookDeliveryQueue],
  exports: [WebhooksOutService],
})
export class WebhooksOutModule {}
