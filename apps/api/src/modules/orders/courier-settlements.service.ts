import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ClosedSettlementView, PendingSettlementView, SettlementsView, SettlementTotals } from '@onefood/shared';
import { TenantDb, type TenantTx } from '../../platform/db/tenant-db.js';
import { newId } from '../../platform/ids.js';
import { CouriersService } from '../delivery/index.js';

/** Entrega concluída por um entregador e ainda fora de qualquer acerto. */
const UNSETTLED = `courier_id IS NOT NULL AND status = 'completed' AND fulfillment = 'delivery'
  AND courier_settlement_id IS NULL`;

interface PendingRow {
  courier_id: string;
  deliveries: string;
  delivery_fees: string;
  cash: string;
  since: Date;
}

/**
 * Acerto com o entregador.
 *
 * - A pagar: o valor por entrega do entregador ou, se ele não tiver um, a taxa de entrega
 *   de cada pedido.
 * - A repassar: o total dos pedidos pagos em dinheiro, que o entregador recebeu em mãos.
 *   Cartão na entrega e Pix caem direto para o restaurante e não entram.
 */
@Injectable()
export class CourierSettlementsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(CouriersService) private readonly couriers: CouriersService,
  ) {}

  async overview(tenantId: string): Promise<SettlementsView> {
    return this.db.withTenant(tenantId, async (tx) => {
      const pending = await this.pending(tx);
      const closed = await tx.query<{
        id: string;
        courier_id: string;
        created_at: Date;
        deliveries: number;
        fees_cents: number;
        cash_cents: number;
        note: string | null;
      }>(
        `SELECT id, courier_id, created_at, deliveries, fees_cents, cash_cents, note
           FROM courier_settlements WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 30`,
        [tenantId],
      );
      const names = await this.couriers.namesOf(
        tx,
        closed.rows.map((row) => row.courier_id),
      );
      const recent: ClosedSettlementView[] = closed.rows.map((row) => ({
        id: row.id,
        courierId: row.courier_id,
        courierName: names.get(row.courier_id) ?? '',
        createdAt: row.created_at.toISOString(),
        deliveries: row.deliveries,
        feesCents: row.fees_cents,
        cashCents: row.cash_cents,
        note: row.note,
      }));
      return { pending, recent };
    });
  }

  /** O que um entregador tem pendente de acerto. É o que ele vê na própria página. */
  async pendingFor(tenantId: string, courierId: string): Promise<SettlementTotals> {
    const [mine] = await this.db.withTenant(tenantId, (tx) => this.pending(tx, courierId));
    return mine
      ? { deliveries: mine.deliveries, feesCents: mine.feesCents, cashCents: mine.cashCents }
      : { deliveries: 0, feesCents: 0, cashCents: 0 };
  }

  /**
   * Fecha o acerto de um entregador: grava os totais e marca as entregas como acertadas,
   * na mesma transação. As entregas ficam travadas até o fim, então dois fechamentos ao
   * mesmo tempo não contam a mesma entrega duas vezes.
   */
  async close(
    tenantId: string,
    courierId: string,
    userId: string,
    note: string | undefined,
  ): Promise<ClosedSettlementView> {
    return this.db.withTenant(tenantId, async (tx) => {
      const courier = (await this.couriers.payRules(tx, [courierId], true)).get(courierId);
      if (!courier) throw new NotFoundException({ error: 'courier_not_found' });

      const orders = await tx.query<{
        id: string;
        created_at: Date;
        delivery_fee_cents: number;
        total_cents: number;
        payment_method: string;
      }>(
        `SELECT id, created_at, delivery_fee_cents, total_cents, payment_method
           FROM orders
          WHERE tenant_id = $1 AND courier_id = $2 AND ${UNSETTLED}
            FOR UPDATE`,
        [tenantId, courierId],
      );
      if (orders.rows.length === 0) throw new ConflictException({ error: 'nothing_to_settle' });

      const totals: SettlementTotals = { deliveries: orders.rows.length, feesCents: 0, cashCents: 0 };
      for (const order of orders.rows) {
        totals.feesCents += courier.feePerDeliveryCents ?? order.delivery_fee_cents;
        if (order.payment_method === 'cash') totals.cashCents += order.total_cents;
      }

      const id = newId();
      const inserted = await tx.query<{ created_at: Date }>(
        `INSERT INTO courier_settlements (tenant_id, id, courier_id, created_by, deliveries, fees_cents, cash_cents, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING created_at`,
        [tenantId, id, courierId, userId, totals.deliveries, totals.feesCents, totals.cashCents, note || null],
      );
      const times = orders.rows.map((order) => order.created_at.getTime());
      await tx.query(
        `UPDATE orders SET courier_settlement_id = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND created_at BETWEEN $4 AND $5`,
        [
          tenantId,
          orders.rows.map((order) => order.id),
          id,
          new Date(Math.min(...times)),
          new Date(Math.max(...times)),
        ],
      );

      return {
        id,
        courierId,
        courierName: courier.name,
        createdAt: (inserted.rows[0]?.created_at ?? new Date()).toISOString(),
        note: note || null,
        ...totals,
      };
    });
  }

  private async pending(tx: TenantTx, courierId?: string): Promise<PendingSettlementView[]> {
    const { rows } = await tx.query<PendingRow>(
      `SELECT courier_id, count(*) AS deliveries,
              coalesce(sum(delivery_fee_cents), 0) AS delivery_fees,
              coalesce(sum(total_cents) FILTER (WHERE payment_method = 'cash'), 0) AS cash,
              min(created_at) AS since
         FROM orders
        WHERE tenant_id = $1 AND ${UNSETTLED} AND ($2::uuid IS NULL OR courier_id = $2)
        GROUP BY courier_id`,
      [tx.tenantId, courierId ?? null],
    );
    const rules = await this.couriers.payRules(
      tx,
      rows.map((row) => row.courier_id),
    );
    return rows
      .map((row) => {
        const rule = rules.get(row.courier_id);
        const deliveries = Number(row.deliveries);
        return {
          courierId: row.courier_id,
          courierName: rule?.name ?? '',
          deliveries,
          feesCents:
            rule?.feePerDeliveryCents != null ? rule.feePerDeliveryCents * deliveries : Number(row.delivery_fees),
          cashCents: Number(row.cash),
          since: row.since.toISOString(),
        };
      })
      .sort((a, b) => a.courierName.localeCompare(b.courierName, 'pt-BR'));
  }
}
