import { Module } from '@nestjs/common';

import { IdempotencyInterceptor } from './idempotency.interceptor';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  controllers: [MessagesController],
  providers: [MessagesService, IdempotencyInterceptor],
  exports: [MessagesService],
})
export class MessagesModule {}
