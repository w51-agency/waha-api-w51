import { Global, Module } from '@nestjs/common';

import { WebhookDeliveryQueue } from './webhook-delivery.queue';
import { WebhookDeliveriesController, WebhooksOutController } from './webhooks-out.controller';
import { WebhooksOutService } from './webhooks-out.service';

@Global()
@Module({
  controllers: [WebhooksOutController, WebhookDeliveriesController],
  providers: [WebhooksOutService, WebhookDeliveryQueue],
  exports: [WebhooksOutService],
})
export class WebhooksOutModule {}
