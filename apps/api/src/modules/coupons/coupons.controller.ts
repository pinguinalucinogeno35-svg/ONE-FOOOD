import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  type CouponPreview,
  type CouponView,
  createCouponSchema,
  previewCouponSchema,
  updateCouponSchema,
} from '@onefood/shared';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../../config.js';
import { parseBody } from '../../platform/http/validation.js';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { TenantsService } from '../../platform/tenants/tenants.service.js';
import { CONFIG } from '../../platform/tokens.js';
import { CurrentStore, RequireRole, SessionGuard, type StoreAuth } from '../identity/index.js';
import { CouponError, CouponsService } from './coupons.service.js';

/** Gestão de cupons no painel. Ver é de qualquer membro; criar e desligar é de dono e gerente. */
@Controller('v1/panel/stores/:slug/coupons')
@UseGuards(SessionGuard)
export class PanelCouponsController {
  constructor(@Inject(CouponsService) private readonly coupons: CouponsService) {}

  @Get()
  list(@CurrentStore() store: StoreAuth): Promise<CouponView[]> {
    return this.coupons.list(store.tenantId);
  }

  @Post()
  @RequireRole('owner', 'manager')
  create(@CurrentStore() store: StoreAuth, @Body() body: unknown): Promise<{ id: string }> {
    return this.coupons.create(store.tenantId, parseBody(createCouponSchema, body));
  }

  @Patch(':couponId')
  @HttpCode(204)
  @RequireRole('owner', 'manager')
  async update(
    @CurrentStore() store: StoreAuth,
    @Param('couponId', ParseUUIDPipe) couponId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.coupons.setActive(store.tenantId, couponId, parseBody(updateCouponSchema, body).active);
  }
}

@Controller('v1/stores/:slug/coupons')
export class PublicCouponsController {
  constructor(
    @Inject(CouponsService) private readonly coupons: CouponsService,
    @Inject(TenantsService) private readonly tenants: TenantsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** O cliente confere o cupom antes de pedir. Limitado por IP, para ninguém adivinhar códigos em massa. */
  @Post('preview')
  @HttpCode(200)
  async preview(
    @Param('slug') slug: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<CouponPreview> {
    const input = parseBody(previewCouponSchema, body);
    const tenantId = await this.tenants.resolveSlug(slug);
    await this.limiter.enforce(
      `coupon-ip:${tenantId}:${request.ip}`,
      this.config.COUPON_PREVIEW_LIMIT_PER_IP_10MIN,
      600,
    );
    try {
      return await this.coupons.preview(tenantId, input.code, input.subtotalCents);
    } catch (error) {
      if (error instanceof CouponError) {
        throw new UnprocessableEntityException({ error: 'coupon_invalid', problem: error.problem });
      }
      throw error;
    }
  }
}
