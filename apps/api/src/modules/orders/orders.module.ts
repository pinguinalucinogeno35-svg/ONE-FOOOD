import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.js';
import { IdentityModule } from '../identity/index.js';
import { OutboxModule } from '../outbox/index.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PanelOrdersController } from './panel-orders.controller.js';
import { PanelOrdersService } from './panel-orders.service.js';

@Module({
  imports: [CatalogModule, OutboxModule, IdentityModule],
  controllers: [OrdersController, PanelOrdersController],
  providers: [OrdersService, PanelOrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
