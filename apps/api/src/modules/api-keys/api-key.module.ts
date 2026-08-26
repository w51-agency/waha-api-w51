import { Global, Module } from '@nestjs/common';

import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';

@Global()
@Module({
  providers: [ApiKeyService, ApiKeyGuard],
  exports: [ApiKeyService, ApiKeyGuard],
})
export class ApiKeyModule {}
