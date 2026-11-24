import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { CourierGuard } from './courier.guard.js';
import { CourierPositionController, PanelCouriersController } from './couriers.controller.js';
import { CouriersService } from './couriers.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [PanelCouriersController, CourierPositionController],
  providers: [CouriersService, CourierGuard],
  exports: [CouriersService, CourierGuard],
})
export class DeliveryModule {}
