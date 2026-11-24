import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import {
  type CourierAccessView,
  type CourierView,
  courierPositionSchema,
  createCourierSchema,
  updateCourierSchema,
} from '@onefood/shared';
import { parseBody } from '../../platform/http/validation.js';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { CurrentStore, RequireRole, SessionGuard, type StoreAuth } from '../identity/index.js';
import { CourierGuard, CurrentCourier } from './courier.guard.js';
import { type CourierIdentity, CouriersService } from './couriers.service.js';

/** Entregadores no painel. Ver é de qualquer membro; cadastrar, alterar e trocar o link é de dono e gerente. */
@Controller('v1/panel/stores/:slug/couriers')
@UseGuards(SessionGuard)
export class PanelCouriersController {
  constructor(@Inject(CouriersService) private readonly couriers: CouriersService) {}

  @Get()
  list(@CurrentStore() store: StoreAuth): Promise<CourierView[]> {
    return this.couriers.list(store.tenantId);
  }

  /** Devolve o token do link de acesso. É a única vez em que ele aparece. */
  @Post()
  @RequireRole('owner', 'manager')
  create(@CurrentStore() store: StoreAuth, @Body() body: unknown): Promise<CourierAccessView> {
    return this.couriers.create(store.tenantId, parseBody(createCourierSchema, body));
  }

  @Patch(':courierId')
  @HttpCode(204)
  @RequireRole('owner', 'manager')
  async update(
    @CurrentStore() store: StoreAuth,
    @Param('courierId', ParseUUIDPipe) courierId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.couriers.update(store.tenantId, courierId, parseBody(updateCourierSchema, body));
  }

  @Post(':courierId/access-token')
  @HttpCode(200)
  @RequireRole('owner', 'manager')
  rotate(
    @CurrentStore() store: StoreAuth,
    @Param('courierId', ParseUUIDPipe) courierId: string,
  ): Promise<CourierAccessView> {
    return this.couriers.rotateAccess(store.tenantId, courierId);
  }
}

@Controller('v1/courier')
@UseGuards(CourierGuard)
export class CourierPositionController {
  constructor(
    @Inject(CouriersService) private readonly couriers: CouriersService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  /** O aparelho do entregador envia onde ele está. Fica guardada só a última posição, por poucos minutos. */
  @Post('position')
  @HttpCode(204)
  async position(@CurrentCourier() courier: CourierIdentity, @Body() body: unknown): Promise<void> {
    const input = parseBody(courierPositionSchema, body);
    await this.limiter.enforce(`courier-pos:${courier.courierId}`, 60, 60);
    await this.couriers.savePosition(courier.tenantId, courier.courierId, input);
  }
}
