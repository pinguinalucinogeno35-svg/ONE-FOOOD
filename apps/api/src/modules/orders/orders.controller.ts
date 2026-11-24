import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Res } from '@nestjs/common';
import { createOrderSchema, type OrderView } from '@onefood/shared';
import type { FastifyReply } from 'fastify';
import { TenantsService } from '../../platform/tenants/tenants.service.js';
import { OrdersService } from './orders.service.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

@Controller('v1/stores/:slug/orders')
export class OrdersController {
  constructor(
    @Inject(TenantsService) private readonly tenants: TenantsService,
    @Inject(OrdersService) private readonly orders: OrdersService,
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
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OrderView> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new BadRequestException({ error: 'idempotency_key_required' });
    }
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'validation_failed',
        problems: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), detail: issue.message })),
      });
    }

    const tenantId = await this.tenants.resolveSlug(slug);
    const { order, replayed } = await this.orders.create(tenantId, parsed.data, idempotencyKey);
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
