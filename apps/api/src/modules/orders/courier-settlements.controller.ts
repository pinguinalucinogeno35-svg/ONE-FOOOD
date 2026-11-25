import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { type ClosedSettlementView, closeSettlementSchema, type SettlementsView } from '@onefood/shared';
import { parseBody } from '../../platform/http/validation.js';
import { CurrentStore, RequireRole, SessionGuard, type StoreAuth } from '../identity/index.js';
import { CourierSettlementsService } from './courier-settlements.service.js';

/** Acerto com os entregadores. Ver é de qualquer membro; fechar é de dono e gerente. */
@Controller('v1/panel/stores/:slug/courier-settlements')
@UseGuards(SessionGuard)
export class CourierSettlementsController {
  constructor(@Inject(CourierSettlementsService) private readonly settlements: CourierSettlementsService) {}

  @Get()
  overview(@CurrentStore() store: StoreAuth): Promise<SettlementsView> {
    return this.settlements.overview(store.tenantId);
  }

  @Post()
  @RequireRole('owner', 'manager')
  close(@CurrentStore() store: StoreAuth, @Body() body: unknown): Promise<ClosedSettlementView> {
    const input = parseBody(closeSettlementSchema, body);
    return this.settlements.close(store.tenantId, input.courierId, store.userId, input.note);
  }
}
