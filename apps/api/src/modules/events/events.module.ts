import { Global, Module } from '@nestjs/common';

import { EventsBus } from './events.bus';

@Global()
@Module({
  providers: [EventsBus],
  exports: [EventsBus],
})
export class EventsModule {}
