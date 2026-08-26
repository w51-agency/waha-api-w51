import { Module } from '@nestjs/common';

import { MetricsController, SessionEventsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  controllers: [MetricsController, SessionEventsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
