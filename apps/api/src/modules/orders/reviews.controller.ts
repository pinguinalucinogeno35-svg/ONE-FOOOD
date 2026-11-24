import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { createReviewSchema, type OrderReviewView, type ReviewsSummaryView } from '@onefood/shared';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../../config.js';
import { parseBody } from '../../platform/http/validation.js';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { TenantsService } from '../../platform/tenants/tenants.service.js';
import { CONFIG } from '../../platform/tokens.js';
import { CurrentStore, SessionGuard, type StoreAuth } from '../identity/index.js';
import { ReviewsService } from './reviews.service.js';

@Controller('v1/stores/:slug/orders/:orderId/review')
export class ReviewsController {
  constructor(
    @Inject(ReviewsService) private readonly reviews: ReviewsService,
    @Inject(TenantsService) private readonly tenants: TenantsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** O cliente avalia o pedido concluído. Como no acompanhamento, o id do pedido é a credencial. */
  @Post()
  async create(
    @Param('slug') slug: string,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OrderReviewView> {
    const input = parseBody(createReviewSchema, body);
    const tenantId = await this.tenants.resolveSlug(slug);
    await this.limiter.enforce(`review-ip:${tenantId}:${request.ip}`, this.config.REVIEW_LIMIT_PER_IP_10MIN, 600);
    return this.reviews.create(tenantId, orderId, input);
  }
}

@Controller('v1/panel/stores/:slug/reviews')
@UseGuards(SessionGuard)
export class PanelReviewsController {
  constructor(@Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  @Get()
  summary(@CurrentStore() store: StoreAuth): Promise<ReviewsSummaryView> {
    return this.reviews.summary(store.tenantId);
  }
}
