import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  allowedTransitions,
  type CourierDeliveryView,
  type DeliveryAddress,
  type Fulfillment,
  type OrderChannel,
  type OrderItemOptionView,
  type OrderItemView,
  type OrderStatus,
  type PanelOrderView,
  type PaymentMethod,
} from '@onefood/shared';
import { TenantDb, type TenantTx } from '../../platform/db/tenant-db.js';
import { isUuidV7, newId, timeOfId } from '../../platform/ids.js';
import { CouponsService } from '../coupons/index.js';
import { CouriersService } from '../delivery/index.js';
import { Outbox } from '../outbox/index.js';

export type OrderScope = 'open' | 'recent';

/** Quem mudou o pedido: alguém do painel ou o entregador. Vai para o histórico de eventos. */
export type OrderActor = { userId: string } | { courierId: string };

interface OrderRow {
  id: string;
  created_at: Date;
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
  coupon_code: string | null;
  courier_id: string | null;
  delivery_address: DeliveryAddress | null;
  customer_name: string;
  customer_phone: string;
}

const ORDER_COLUMNS = `o.id, o.created_at, o.number, o.status, o.channel, o.fulfillment, o.payment_method,
  o.subtotal_cents, o.delivery_fee_cents, o.discount_cents, o.total_cents, o.notes, o.coupon_code, o.courier_id,
  o.delivery_address,
  c.name AS customer_name, c.phone AS customer_phone`;
const ORDER_FROM = 'orders o JOIN customers c ON c.tenant_id = o.tenant_id AND c.id = o.customer_id';

/** Pedidos como o restaurante vê e opera no painel e na cozinha. */
@Injectable()
export class PanelOrdersService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(CouponsService) private readonly coupons: CouponsService,
    @Inject(CouriersService) private readonly couriers: CouriersService,
  ) {}

  /**
   * "open": o que está em andamento, do mais antigo para o mais novo (ordem de preparo).
   * "recent": o que foi concluído ou cancelado nas últimas 24 horas, do mais novo para o mais antigo.
   * As duas consultas têm limite de data, então só tocam as partições recentes.
   */
  async list(tenantId: string, scope: OrderScope): Promise<PanelOrderView[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const orders =
        scope === 'open'
          ? await tx.query<OrderRow>(
              `SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM}
                WHERE o.tenant_id = $1 AND o.created_at >= now() - interval '7 days'
                  AND o.status NOT IN ('completed', 'cancelled')
                ORDER BY o.created_at LIMIT 300`,
              [tenantId],
            )
          : await tx.query<OrderRow>(
              `SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM}
                WHERE o.tenant_id = $1 AND o.created_at >= now() - interval '24 hours'
                  AND o.status IN ('completed', 'cancelled')
                ORDER BY o.created_at DESC LIMIT 100`,
              [tenantId],
            );
      return this.withItems(tx, orders.rows);
    });
  }

  /**
   * Muda o estado do pedido, registra o evento e avisa os painéis, tudo em uma transação.
   * Pedir o estado em que o pedido já está não é erro: dois cliques não viram dois eventos.
   */
  async changeStatus(
    tenantId: string,
    orderId: string,
    target: OrderStatus,
    actor: OrderActor,
  ): Promise<PanelOrderView> {
    if (!isUuidV7(orderId)) throw orderNotFound();
    const createdAt = timeOfId(orderId);

    return this.db.withTenant(tenantId, async (tx) => {
      const found = await tx.query<OrderRow>(
        `SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM}
          WHERE o.tenant_id = $1 AND o.id = $2 AND o.created_at = $3
            FOR UPDATE OF o`,
        [tenantId, orderId, createdAt],
      );
      const row = found.rows[0];
      // Para o entregador, pedido de outro entregador é como se não existisse.
      if (!row || ('courierId' in actor && row.courier_id !== actor.courierId)) throw orderNotFound();

      if (row.status !== target) {
        const allowed = allowedTransitions(row.status, row.fulfillment);
        if (!allowed.includes(target)) {
          throw new ConflictException({ error: 'invalid_transition', from: row.status, to: target, allowed });
        }

        await tx.query(
          'UPDATE orders SET status = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND created_at = $3',
          [tenantId, orderId, createdAt, target],
        );
        await tx.query(
          `INSERT INTO order_events (tenant_id, id, order_id, order_created_at, type, payload)
           VALUES ($1, $2, $3, $4, 'order.status_changed', $5)`,
          [tenantId, newId(), orderId, createdAt, JSON.stringify({ from: row.status, to: target, ...actor })],
        );

        if (target === 'cancelled') {
          await tx.query(
            `UPDATE payments SET status = 'cancelled', updated_at = now()
              WHERE tenant_id = $1 AND order_id = $2 AND status = 'pending'`,
            [tenantId, orderId],
          );
          await this.coupons.release(tx, orderId);
        }
        // Dinheiro e cartão na entrega são recebidos na conclusão. Pix só muda com o aviso do provedor.
        if (target === 'completed' && row.payment_method !== 'pix') {
          await tx.query(
            `UPDATE payments SET status = 'paid', paid_at = now(), updated_at = now()
              WHERE tenant_id = $1 AND order_id = $2 AND status = 'pending'`,
            [tenantId, orderId],
          );
        }

        await this.outbox.emit(tx, 'order.status_changed', {
          orderId,
          number: Number(row.number),
          from: row.status,
          to: target,
        });
        row.status = target;
      }

      const [order] = await this.withItems(tx, [row]);
      if (!order) throw orderNotFound();
      return order;
    });
  }

  /**
   * Define ou retira o entregador de um pedido de entrega em andamento. Registra o evento e
   * avisa os painéis. Repetir a mesma atribuição não gera evento.
   */
  async assignCourier(
    tenantId: string,
    orderId: string,
    courierId: string | null,
    userId: string,
  ): Promise<PanelOrderView> {
    if (!isUuidV7(orderId)) throw orderNotFound();
    const createdAt = timeOfId(orderId);

    return this.db.withTenant(tenantId, async (tx) => {
      const found = await tx.query<OrderRow>(
        `SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM}
          WHERE o.tenant_id = $1 AND o.id = $2 AND o.created_at = $3
            FOR UPDATE OF o`,
        [tenantId, orderId, createdAt],
      );
      const row = found.rows[0];
      if (!row) throw orderNotFound();
      if (row.fulfillment !== 'delivery') throw new ConflictException({ error: 'not_a_delivery' });
      if (row.status === 'completed' || row.status === 'cancelled') {
        throw new ConflictException({ error: 'order_closed' });
      }

      if (row.courier_id !== courierId) {
        if (courierId) await this.couriers.requireActive(tx, courierId);
        await tx.query(
          'UPDATE orders SET courier_id = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND created_at = $3',
          [tenantId, orderId, createdAt, courierId],
        );
        await tx.query(
          `INSERT INTO order_events (tenant_id, id, order_id, order_created_at, type, payload)
           VALUES ($1, $2, $3, $4, 'order.courier_assigned', $5)`,
          [tenantId, newId(), orderId, createdAt, JSON.stringify({ from: row.courier_id, to: courierId, userId })],
        );
        await this.outbox.emit(tx, 'order.courier_assigned', { orderId, number: Number(row.number), courierId });
        row.courier_id = courierId;
      }

      const [order] = await this.withItems(tx, [row]);
      if (!order) throw orderNotFound();
      return order;
    });
  }

  /** Entregas em andamento de um entregador, da mais antiga para a mais nova. */
  async listForCourier(tenantId: string, courierId: string): Promise<CourierDeliveryView[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const orders = await tx.query<OrderRow>(
        `SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM}
          WHERE o.tenant_id = $1 AND o.courier_id = $2 AND o.created_at >= now() - interval '7 days'
            AND o.status NOT IN ('completed', 'cancelled')
          ORDER BY o.created_at LIMIT 50`,
        [tenantId, courierId],
      );
      const views = await this.withItems(tx, orders.rows);
      return views.flatMap((order) =>
        order.deliveryAddress
          ? [
              {
                orderId: order.id,
                number: order.number,
                status: order.status,
                customer: order.customer,
                address: order.deliveryAddress,
                notes: order.notes,
                paymentMethod: order.paymentMethod,
                totalCents: order.totalCents,
                itemsSummary: order.items.map((item) => `${item.quantity} x ${item.productName}`).join(', '),
              },
            ]
          : [],
      );
    });
  }

  private async withItems(tx: TenantTx, rows: OrderRow[]): Promise<PanelOrderView[]> {
    if (rows.length === 0) return [];
    const times = rows.map((row) => row.created_at.getTime());
    const items = await tx.query<{
      order_id: string;
      line_no: number;
      product_id: string;
      product_name: string;
      quantity: number;
      unit_price_cents: number;
      options: OrderItemOptionView[];
      total_cents: number;
      notes: string | null;
    }>(
      `SELECT order_id, line_no, product_id, product_name, quantity, unit_price_cents, options, total_cents, notes
         FROM order_items
        WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])
          AND order_created_at BETWEEN $3 AND $4
        ORDER BY order_id, line_no`,
      [tx.tenantId, rows.map((row) => row.id), new Date(Math.min(...times)), new Date(Math.max(...times))],
    );
    const courierNames = await this.couriers.namesOf(
      tx,
      rows.flatMap((row) => (row.courier_id ? [row.courier_id] : [])),
    );
    const itemsByOrder = new Map<string, OrderItemView[]>();
    for (const item of items.rows) {
      const list = itemsByOrder.get(item.order_id) ?? [];
      list.push({
        lineNo: item.line_no,
        productId: item.product_id,
        productName: item.product_name,
        quantity: item.quantity,
        unitPriceCents: item.unit_price_cents,
        options: item.options,
        totalCents: item.total_cents,
        notes: item.notes,
      });
      itemsByOrder.set(item.order_id, list);
    }

    return rows.map((row) => ({
      id: row.id,
      number: Number(row.number),
      status: row.status,
      channel: row.channel,
      fulfillment: row.fulfillment,
      paymentMethod: row.payment_method,
      subtotalCents: row.subtotal_cents,
      deliveryFeeCents: row.delivery_fee_cents,
      discountCents: row.discount_cents,
      couponCode: row.coupon_code,
      totalCents: row.total_cents,
      notes: row.notes,
      createdAt: row.created_at.toISOString(),
      items: itemsByOrder.get(row.id) ?? [],
      customer: { name: row.customer_name, phone: row.customer_phone },
      deliveryAddress: row.delivery_address,
      courier: row.courier_id ? { id: row.courier_id, name: courierNames.get(row.courier_id) ?? '' } : null,
    }));
  }
}

function orderNotFound(): NotFoundException {
  return new NotFoundException({ error: 'order_not_found' });
}
