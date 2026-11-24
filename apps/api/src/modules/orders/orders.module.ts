import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.js';
import { OutboxModule } from '../outbox/index.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [CatalogModule, OutboxModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
