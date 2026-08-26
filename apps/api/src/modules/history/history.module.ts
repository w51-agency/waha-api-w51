import { Module } from '@nestjs/common';

import { ChatsController, MediaController, MessagesHistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  controllers: [MessagesHistoryController, ChatsController, MediaController],
  providers: [HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}
