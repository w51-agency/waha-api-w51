import { Module } from '@nestjs/common';

import { WebhookIngestController } from './webhook-ingest.controller';
import { WebhookIngestService } from './webhook-ingest.service';

@Module({
  controllers: [WebhookIngestController],
  providers: [WebhookIngestService],
  exports: [WebhookIngestService],
})
export class WebhookIngestModule {}
