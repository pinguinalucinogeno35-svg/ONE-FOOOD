import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { PanelCouponsController, PublicCouponsController } from './coupons.controller.js';
import { CouponsService } from './coupons.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [PanelCouponsController, PublicCouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
