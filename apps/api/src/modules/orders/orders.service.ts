import { createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  CreateOrderInput,
  Fulfillment,
  OrderChannel,
  OrderCreatedEvent,
  OrderItemOptionView,
  OrderStatus,
  OrderView,
  PaymentMethod,
} from '@onefood/shared';
import { TenantDb, type TenantTx } from '../../platform/db/tenant-db.js';
import { isUuidV7, newId, timeOfId } from '../../platform/ids.js';
import { CatalogService } from '../catalog/index.js';
import { Outbox } from '../outbox/index.js';
import { PricingError, priceOrder } from './pricing.js';

const IDEMPOTENCY_SCOPE = 'order.create';

export interface CreateOrderResult {
  order: OrderView;
  /** true quando a chave de idempotência já tinha sido usada e o pedido original foi devolvido. */
  replayed: boolean;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(Outbox) private readonly outbox: Outbox,
  ) {}

  /**
   * Cria o pedido em uma única transação: chave de idempotência, cliente, número,
   * pedido, itens, evento, pagamento pendente e o registro no outbox. Ou tudo entra,
   * ou nada entra. Nada que dependa de terceiros acontece aqui: isso é trabalho dos workers.
   */
  async create(
    tenantId: string,
    input: CreateOrderInput,
    idempotencyKey: string,
    channel: OrderChannel = 'web',
  ): Promise<CreateOrderResult> {
    const requestHash = hashRequest(input);

    return this.db.withTenant(tenantId, async (tx) => {
      const orderId = newId();
      const createdAt = timeOfId(orderId);

      // Dois envios simultâneos com a mesma chave: o segundo espera aqui o primeiro terminar.
      const claimed = await tx.query(
        `INSERT INTO idempotency_keys (tenant_id, scope, key, request_hash, resource_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, scope, key) DO NOTHING`,
        [tenantId, IDEMPOTENCY_SCOPE, idempotencyKey, requestHash, orderId],
      );
      if (claimed.rowCount === 0) {
        return { order: await this.replay(tx, idempotencyKey, requestHash), replayed: true };
      }

      const products = await this.catalog.getProductsForPricing(
        tx,
        input.items.map((item) => item.productId),
      );
      const store = await tx.query<{ delivery_fee_cents: number }>(
        'SELECT delivery_fee_cents FROM tenants WHERE id = $1',
        [tenantId],
      );
      let priced: ReturnType<typeof priceOrder>;
      try {
        priced = priceOrder(input, products, store.rows[0]?.delivery_fee_cents ?? 0);
      } catch (error) {
        if (error instanceof PricingError) {
          throw new UnprocessableEntityException({ error: 'order_invalid', problems: error.problems });
        }
        throw error;
      }

      const customer = await tx.query<{ id: string }>(
        `INSERT INTO customers (tenant_id, id, phone, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, phone) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
         RETURNING id`,
        [tenantId, newId(), input.customer.phone, input.customer.name],
      );
      const customerId = customer.rows[0]?.id;
      if (!customerId) throw new Error('cliente não foi gravado');

      const sequence = await tx.query<{ value: string }>(
        `INSERT INTO tenant_sequences (tenant_id, name, value)
         VALUES ($1, 'order', 1)
         ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_sequences.value + 1
         RETURNING value`,
        [tenantId],
      );
      const number = Number(sequence.rows[0]?.value);

      await tx.query(
        `INSERT INTO orders (tenant_id, id, created_at, number, customer_id, channel, fulfillment,
                             payment_method, subtotal_cents, delivery_fee_cents, discount_cents,
                             total_cents, delivery_address, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          tenantId,
          orderId,
          createdAt,
          number,
          customerId,
          channel,
          input.fulfillment,
          input.paymentMethod,
          priced.subtotalCents,
          priced.deliveryFeeCents,
          priced.discountCents,
          priced.totalCents,
          input.fulfillment === 'delivery' ? JSON.stringify(input.deliveryAddress) : null,
          input.notes ?? null,
        ],
      );

      await tx.query(
        `INSERT INTO order_items (tenant_id, order_id, order_created_at, line_no, product_id, product_name,
                                  quantity, unit_price_cents, options, total_cents, notes)
         SELECT $1, $2, $3, line.line_no, line.product_id, line.product_name, line.quantity,
                line.unit_price_cents, line.options, line.total_cents, line.notes
           FROM jsonb_to_recordset($4::jsonb) AS line(
                  line_no integer, product_id uuid, product_name text, quantity integer,
                  unit_price_cents integer, options jsonb, total_cents integer, notes text)`,
        [
          tenantId,
          orderId,
          createdAt,
          JSON.stringify(
            priced.lines.map((line) => ({
              line_no: line.lineNo,
              product_id: line.productId,
              product_name: line.productName,
              quantity: line.quantity,
              unit_price_cents: line.unitPriceCents,
              options: line.options,
              total_cents: line.totalCents,
              notes: line.notes,
            })),
          ),
        ],
      );

      const event: OrderCreatedEvent = {
        orderId,
        number,
        totalCents: priced.totalCents,
        fulfillment: input.fulfillment,
        paymentMethod: input.paymentMethod,
      };
      await tx.query(
        `INSERT INTO order_events (tenant_id, id, order_id, order_created_at, type, payload)
         VALUES ($1, $2, $3, $4, 'order.created', $5)`,
        [tenantId, newId(), orderId, createdAt, JSON.stringify(event)],
      );
      await tx.query(
        `INSERT INTO payments (tenant_id, id, order_id, order_created_at, method, amount_cents)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, newId(), orderId, createdAt, input.paymentMethod, priced.totalCents],
      );
      // Mesma transação do pedido: se o pedido existe, o evento existe.
      await this.outbox.emit(tx, 'order.created', event);

      const order: OrderView = {
        id: orderId,
        number,
        status: 'pending',
        channel,
        fulfillment: input.fulfillment,
        paymentMethod: input.paymentMethod,
        subtotalCents: priced.subtotalCents,
        deliveryFeeCents: priced.deliveryFeeCents,
        discountCents: priced.discountCents,
        totalCents: priced.totalCents,
        notes: input.notes ?? null,
        createdAt: createdAt.toISOString(),
        items: priced.lines,
      };
      return { order, replayed: false };
    });
  }

  async get(tenantId: string, orderId: string): Promise<OrderView> {
    if (!isUuidV7(orderId)) throw orderNotFound();
    const order = await this.db.withTenant(tenantId, (tx) => this.load(tx, orderId));
    if (!order) throw orderNotFound();
    return order;
  }

  private async replay(tx: TenantTx, idempotencyKey: string, requestHash: string): Promise<OrderView> {
    const existing = await tx.query<{ request_hash: string; resource_id: string }>(
      'SELECT request_hash, resource_id FROM idempotency_keys WHERE tenant_id = $1 AND scope = $2 AND key = $3',
      [tx.tenantId, IDEMPOTENCY_SCOPE, idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.request_hash !== requestHash) {
      throw new ConflictException({ error: 'idempotency_key_reused' });
    }
    const order = await this.load(tx, row.resource_id);
    if (!order) throw new ConflictException({ error: 'idempotency_key_reused' });
    return order;
  }

  /** created_at vem do próprio id, então a busca cai direto na partição do mês do pedido. */
  private async load(tx: TenantTx, orderId: string): Promise<OrderView | null> {
    const createdAt = timeOfId(orderId);
    const orders = await tx.query<{
      number: string;
      status: OrderStatus;
      channel: OrderChannel;
      fulfillment: Fulfillment;
      payment_method: PaymentMethod;
      subtotal_cents: number;
      delivery_fee_cents: number;
      discount_cents: number;
      total_cents: number;
      notes: string | null;
    }>(
      `SELECT number, status, channel, fulfillment, payment_method, subtotal_cents,
              delivery_fee_cents, discount_cents, total_cents, notes
         FROM orders WHERE tenant_id = $1 AND id = $2 AND created_at = $3`,
      [tx.tenantId, orderId, createdAt],
    );
    const row = orders.rows[0];
    if (!row) return null;

    const items = await tx.query<{
      line_no: number;
      product_id: string;
      product_name: string;
      quantity: number;
      unit_price_cents: number;
      options: OrderItemOptionView[];
      total_cents: number;
      notes: string | null;
    }>(
      `SELECT line_no, product_id, product_name, quantity, unit_price_cents, options, total_cents, notes
         FROM order_items
        WHERE tenant_id = $1 AND order_id = $2 AND order_created_at = $3
        ORDER BY line_no`,
      [tx.tenantId, orderId, createdAt],
    );

    return {
      id: orderId,
      number: Number(row.number),
      status: row.status,
      channel: row.channel,
      fulfillment: row.fulfillment,
      paymentMethod: row.payment_method,
      subtotalCents: row.subtotal_cents,
      deliveryFeeCents: row.delivery_fee_cents,
      discountCents: row.discount_cents,
      totalCents: row.total_cents,
      notes: row.notes,
      createdAt: createdAt.toISOString(),
      items: items.rows.map((item) => ({
        lineNo: item.line_no,
        productId: item.product_id,
        productName: item.product_name,
        quantity: item.quantity,
        unitPriceCents: item.unit_price_cents,
        options: item.options,
        totalCents: item.total_cents,
        notes: item.notes,
      })),
    };
  }
}

/** Mesma chave com corpo diferente é erro do cliente, não repetição. */
function hashRequest(input: CreateOrderInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function orderNotFound(): NotFoundException {
  return new NotFoundException({ error: 'order_not_found' });
}
