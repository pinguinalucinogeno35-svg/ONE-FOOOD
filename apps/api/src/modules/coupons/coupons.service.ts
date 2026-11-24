import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CouponKind,
  type CouponPreview,
  type CouponProblem,
  type CouponView,
  type CreateCouponInput,
  couponDiscount,
} from '@onefood/shared';
import { TenantDb, type TenantTx } from '../../platform/db/tenant-db.js';
import { newId } from '../../platform/ids.js';

interface CouponRow {
  id: string;
  code: string;
  kind: CouponKind;
  value: number;
  min_order_cents: number;
  max_discount_cents: number | null;
  starts_at: Date | null;
  ends_at: Date | null;
  max_redemptions: number | null;
  once_per_customer: boolean;
  active: boolean;
  redemptions: number;
}

const COLUMNS = `id, code, kind, value, min_order_cents, max_discount_cents, starts_at, ends_at,
  max_redemptions, once_per_customer, active, redemptions`;

/** O cupom não vale para este pedido. `problem` diz o porquê, para a tela explicar ao cliente. */
export class CouponError extends Error {
  constructor(readonly problem: CouponProblem) {
    super(`cupom recusado: ${problem}`);
  }
}

/** Dono das tabelas de cupons. O módulo de pedidos pede o desconto por aqui. */
@Injectable()
export class CouponsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  async list(tenantId: string): Promise<CouponView[]> {
    const { rows } = await this.db.withTenant(tenantId, (tx) =>
      tx.query<CouponRow>(`SELECT ${COLUMNS} FROM coupons WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]),
    );
    return rows.map(toView);
  }

  async create(tenantId: string, input: CreateCouponInput): Promise<{ id: string }> {
    const id = newId();
    try {
      await this.db.withTenant(tenantId, (tx) =>
        tx.query(
          `INSERT INTO coupons (tenant_id, id, code, kind, value, min_order_cents, max_discount_cents,
                                starts_at, ends_at, max_redemptions, once_per_customer)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            tenantId,
            id,
            input.code,
            input.kind,
            input.value,
            input.minOrderCents,
            // Teto só faz sentido em cupom percentual.
            input.kind === 'percent' ? input.maxDiscountCents : null,
            input.startsAt,
            input.endsAt,
            input.maxRedemptions,
            input.oncePerCustomer,
          ],
        ),
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException({ error: 'coupon_code_taken' });
      throw error;
    }
    return { id };
  }

  async setActive(tenantId: string, couponId: string, active: boolean): Promise<void> {
    const updated = await this.db.withTenant(tenantId, (tx) =>
      tx.query('UPDATE coupons SET active = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2', [
        tenantId,
        couponId,
        active,
      ]),
    );
    if (updated.rowCount === 0) throw new NotFoundException({ error: 'coupon_not_found' });
  }

  /**
   * Quanto o cupom daria de desconto, para a tela mostrar antes do pedido. Não reserva nada
   * e não sabe quem é o cliente: a conferência que vale é a de `redeem`, na hora do pedido.
   */
  async preview(tenantId: string, code: string, subtotalCents: number): Promise<CouponPreview> {
    return this.db.withTenant(tenantId, async (tx) => {
      const { rows } = await tx.query<CouponRow>(`SELECT ${COLUMNS} FROM coupons WHERE tenant_id = $1 AND code = $2`, [
        tenantId,
        code,
      ]);
      const coupon = check(rows[0], subtotalCents);
      return { code: coupon.code, discountCents: couponDiscount(toView(coupon), subtotalCents) };
    });
  }

  /**
   * Usa o cupom em um pedido, dentro da transação do pedido. A linha do cupom fica travada
   * até o COMMIT: dois pedidos simultâneos não passam juntos do limite de usos.
   */
  async redeem(
    tx: TenantTx,
    input: { code: string; customerId: string; subtotalCents: number; orderId: string; orderCreatedAt: Date },
  ): Promise<{ code: string; discountCents: number }> {
    const { rows } = await tx.query<CouponRow>(
      `SELECT ${COLUMNS} FROM coupons WHERE tenant_id = $1 AND code = $2 FOR UPDATE`,
      [tx.tenantId, input.code],
    );
    const coupon = check(rows[0], input.subtotalCents);

    if (coupon.once_per_customer) {
      const used = await tx.query(
        `SELECT 1 FROM coupon_redemptions
          WHERE tenant_id = $1 AND coupon_id = $2 AND customer_id = $3 AND voided_at IS NULL
          LIMIT 1`,
        [tx.tenantId, coupon.id, input.customerId],
      );
      if (used.rowCount) throw new CouponError('already_used');
    }

    const discountCents = couponDiscount(toView(coupon), input.subtotalCents);
    if (discountCents <= 0) throw new CouponError('min_order');

    await tx.query(
      `INSERT INTO coupon_redemptions (tenant_id, order_id, order_created_at, coupon_id, customer_id, discount_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tx.tenantId, input.orderId, input.orderCreatedAt, coupon.id, input.customerId, discountCents],
    );
    await tx.query('UPDATE coupons SET redemptions = redemptions + 1 WHERE tenant_id = $1 AND id = $2', [
      tx.tenantId,
      coupon.id,
    ]);
    return { code: coupon.code, discountCents };
  }

  /** Pedido cancelado devolve o uso do cupom: o cliente pode usá-lo de novo e a contagem volta. */
  async release(tx: TenantTx, orderId: string): Promise<void> {
    const voided = await tx.query<{ coupon_id: string }>(
      `UPDATE coupon_redemptions SET voided_at = now()
        WHERE tenant_id = $1 AND order_id = $2 AND voided_at IS NULL
        RETURNING coupon_id`,
      [tx.tenantId, orderId],
    );
    const couponId = voided.rows[0]?.coupon_id;
    if (!couponId) return;
    await tx.query('UPDATE coupons SET redemptions = redemptions - 1 WHERE tenant_id = $1 AND id = $2', [
      tx.tenantId,
      couponId,
    ]);
  }
}

/** Regras que não dependem de quem é o cliente. */
function check(coupon: CouponRow | undefined, subtotalCents: number): CouponRow {
  if (!coupon) throw new CouponError('not_found');
  if (!coupon.active) throw new CouponError('inactive');
  const now = Date.now();
  if (coupon.starts_at && coupon.starts_at.getTime() > now) throw new CouponError('not_started');
  if (coupon.ends_at && coupon.ends_at.getTime() <= now) throw new CouponError('expired');
  if (subtotalCents < coupon.min_order_cents) throw new CouponError('min_order');
  if (coupon.max_redemptions !== null && coupon.redemptions >= coupon.max_redemptions) {
    throw new CouponError('exhausted');
  }
  return coupon;
}

function toView(row: CouponRow): CouponView {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: row.value,
    minOrderCents: row.min_order_cents,
    maxDiscountCents: row.max_discount_cents,
    startsAt: row.starts_at?.toISOString() ?? null,
    endsAt: row.ends_at?.toISOString() ?? null,
    maxRedemptions: row.max_redemptions,
    oncePerCustomer: row.once_per_customer,
    active: row.active,
    redemptions: row.redemptions,
  };
}
