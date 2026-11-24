import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { type CourierHomeView, courierStatusSchema } from '@onefood/shared';
import { parseBody } from '../../platform/http/validation.js';
import { CourierGuard, type CourierIdentity, CurrentCourier } from '../delivery/index.js';
import { PanelOrdersService } from './panel-orders.service.js';

/** O que o entregador faz pelo link pessoal: ver as próprias entregas e avisar que saiu e que entregou. */
@Controller('v1/courier')
@UseGuards(CourierGuard)
export class CourierDeliveriesController {
  constructor(@Inject(PanelOrdersService) private readonly orders: PanelOrdersService) {}

  @Get('deliveries')
  async home(@CurrentCourier() courier: CourierIdentity): Promise<CourierHomeView> {
    return {
      courier: { name: courier.name },
      store: { name: courier.storeName },
      deliveries: await this.orders.listForCourier(courier.tenantId, courier.courierId),
    };
  }

  @Post('deliveries/:orderId/status')
  @HttpCode(204)
  async changeStatus(
    @CurrentCourier() courier: CourierIdentity,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const { status } = parseBody(courierStatusSchema, body);
    await this.orders.changeStatus(courier.tenantId, orderId, status, { courierId: courier.courierId });
  }
}
