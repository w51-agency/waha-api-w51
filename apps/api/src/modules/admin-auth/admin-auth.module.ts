import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminGuard],
  exports: [AdminAuthService, AdminGuard, JwtModule],
})
export class AdminAuthModule {}
