import { Module } from '@nestjs/common';

import { AdminHistoryController } from './admin-history.controller';
import { ChatsController, MediaController, MessagesHistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  controllers: [
    MessagesHistoryController,
    ChatsController,
    MediaController,
    AdminHistoryController,
  ],
  providers: [HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}
