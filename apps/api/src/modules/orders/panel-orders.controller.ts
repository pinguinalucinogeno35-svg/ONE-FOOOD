import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { assignCourierSchema, type PanelOrderView, updateOrderStatusSchema } from '@onefood/shared';
import type { Config } from '../../config.js';
import { parseBody } from '../../platform/http/validation.js';
import { CONFIG } from '../../platform/tokens.js';
import { CurrentStore, SessionGuard, type StoreAuth } from '../identity/index.js';
import { signRealtimeToken } from '../realtime/index.js';
import { PanelOrdersService } from './panel-orders.service.js';

/** Painel de pedidos e monitor de cozinha. Qualquer membro do restaurante opera pedidos. */
@Controller('v1/panel/stores/:slug')
@UseGuards(SessionGuard)
export class PanelOrdersController {
  constructor(
    @Inject(PanelOrdersService) private readonly orders: PanelOrdersService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get('orders')
  list(@CurrentStore() store: StoreAuth, @Query('scope') scope: string | undefined): Promise<PanelOrderView[]> {
    if (scope !== undefined && scope !== 'open' && scope !== 'recent') {
      throw new BadRequestException({
        error: 'validation_failed',
        problems: [{ path: 'scope', detail: 'open ou recent' }],
      });
    }
    return this.orders.list(store.tenantId, scope ?? 'open');
  }

  @Post('orders/:orderId/status')
  @HttpCode(200)
  changeStatus(
    @CurrentStore() store: StoreAuth,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<PanelOrderView> {
    const { status } = parseBody(updateOrderStatusSchema, body);
    return this.orders.changeStatus(store.tenantId, orderId, status, { userId: store.userId });
  }

  /** Escolhe quem leva o pedido. Qualquer membro do restaurante pode atribuir. */
  @Post('orders/:orderId/courier')
  @HttpCode(200)
  assignCourier(
    @CurrentStore() store: StoreAuth,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<PanelOrderView> {
    const { courierId } = parseBody(assignCourierSchema, body);
    return this.orders.assignCourier(store.tenantId, orderId, courierId, store.userId);
  }

  /** O painel avisa que imprimiu o pedido. */
  @Post('orders/:orderId/printed')
  @HttpCode(204)
  async markPrinted(@CurrentStore() store: StoreAuth, @Param('orderId') orderId: string): Promise<void> {
    await this.orders.markPrinted(store.tenantId, orderId, store.userId);
  }

  /**
   * Token curto para o painel abrir a conexão de tempo real. Vale 60 segundos e só para
   * este restaurante; o painel pede outro a cada reconexão.
   */
  @Post('realtime-token')
  @HttpCode(200)
  realtimeToken(@CurrentStore() store: StoreAuth): { token: string; url: string } {
    return {
      token: signRealtimeToken(this.config.REALTIME_TOKEN_SECRET, store.tenantId, 60),
      url: this.config.REALTIME_PUBLIC_URL,
    };
  }
}
