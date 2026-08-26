import { Global, Module } from '@nestjs/common';

import { WahaClient } from './waha.client';

@Global()
@Module({
  providers: [WahaClient],
  exports: [WahaClient],
})
export class WahaModule {}
