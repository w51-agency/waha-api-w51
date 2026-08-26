import { Module } from '@nestjs/common';

import { AdminSessionsController } from './admin-sessions.controller';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionsSyncService } from './sessions.sync';

@Module({
  controllers: [SessionsController, AdminSessionsController],
  providers: [SessionsService, SessionsSyncService],
  exports: [SessionsService],
})
export class SessionsModule {}
