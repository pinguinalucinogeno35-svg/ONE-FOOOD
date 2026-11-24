import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { IdentityService } from './identity.service.js';
import { SessionGuard } from './session.guard.js';

@Module({
  controllers: [AuthController],
  providers: [IdentityService, SessionGuard],
  exports: [IdentityService, SessionGuard],
})
export class IdentityModule {}
