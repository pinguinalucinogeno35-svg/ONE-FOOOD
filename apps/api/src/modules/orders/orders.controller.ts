import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { createOrderSchema, type OrderView } from '@onefood/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../../config.js';
import { parseBody } from '../../platform/http/validation.js';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { TenantsService } from '../../platform/tenants/tenants.service.js';
import { CONFIG } from '../../platform/tokens.js';
import { OrdersService } from './orders.service.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

@Controller('v1/stores/:slug/orders')
export class OrdersController {
  constructor(
    @Inject(TenantsService) private readonly tenants: TenantsService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /**
   * Pedido sem app e sem login. O cabeçalho Idempotency-Key é obrigatório: clique duplo
   * ou reenvio com a mesma chave devolve o mesmo pedido (200) em vez de criar outro (201).
   */
  @Post()
  async create(
    @Param('slug') slug: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OrderView> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new BadRequestException({ error: 'idempotency_key_required' });
    }
    const input = parseBody(createOrderSchema, body);

    const tenantId = await this.tenants.resolveSlug(slug);
    // Pedido sem login: o limite por IP segura trote em massa; o limite por loja impede
    // que um restaurante com tráfego anormal derrube os outros.
    await this.limiter.enforce(`order-ip:${tenantId}:${request.ip}`, this.config.ORDER_LIMIT_PER_IP_10MIN, 600);
    await this.limiter.enforce(`order-store:${tenantId}`, this.config.ORDER_LIMIT_PER_STORE_MIN, 60);
    const { order, replayed } = await this.orders.create(tenantId, input, idempotencyKey);
    reply.status(replayed ? 200 : 201);
    return order;
  }

  /** Acompanhamento pelo cliente. O id do pedido é a credencial: só quem pediu o conhece. */
  @Get(':orderId')
  async get(@Param('slug') slug: string, @Param('orderId') orderId: string): Promise<OrderView> {
    const tenantId = await this.tenants.resolveSlug(slug);
    return this.orders.get(tenantId, orderId);
  }
}
