import { Module } from '@nestjs/common';

import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionsSyncService } from './sessions.sync';

@Module({
  controllers: [SessionsController],
  providers: [SessionsService, SessionsSyncService],
  exports: [SessionsService],
})
export class SessionsModule {}
