import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.js';
import { CouponsModule } from '../coupons/index.js';
import { DeliveryModule } from '../delivery/index.js';
import { IdentityModule } from '../identity/index.js';
import { OutboxModule } from '../outbox/index.js';
import { CourierDeliveriesController } from './courier-deliveries.controller.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PanelOrdersController } from './panel-orders.controller.js';
import { PanelOrdersService } from './panel-orders.service.js';
import { PanelReviewsController, ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({
  imports: [CatalogModule, OutboxModule, IdentityModule, CouponsModule, DeliveryModule],
  controllers: [
    OrdersController,
    PanelOrdersController,
    ReviewsController,
    PanelReviewsController,
    CourierDeliveriesController,
  ],
  providers: [OrdersService, PanelOrdersService, ReviewsService],
  exports: [OrdersService],
})
export class OrdersModule {}
