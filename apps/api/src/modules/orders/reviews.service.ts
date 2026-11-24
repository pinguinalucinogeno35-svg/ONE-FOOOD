import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  type CreateReviewInput,
  LOW_RATING_MAX,
  type OrderReviewView,
  type OrderStatus,
  type PanelReviewView,
  type ReviewItemRating,
  type ReviewsSummaryView,
} from '@onefood/shared';
import { TenantDb, type TenantTx } from '../../platform/db/tenant-db.js';
import { isUuidV7, timeOfId } from '../../platform/ids.js';
import { Outbox } from '../outbox/index.js';

interface ReviewRow {
  rating: number;
  comment: string | null;
  item_ratings: ReviewItemRating[];
  created_at: Date;
}

/** Avaliação pós-pedido: uma por pedido, só depois de concluído, com nota por prato opcional. */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(Outbox) private readonly outbox: Outbox,
  ) {}

  async find(tx: TenantTx, orderId: string): Promise<OrderReviewView | null> {
    const { rows } = await tx.query<ReviewRow>(
      'SELECT rating, comment, item_ratings, created_at FROM order_reviews WHERE tenant_id = $1 AND order_id = $2',
      [tx.tenantId, orderId],
    );
    return rows[0] ? toView(rows[0]) : null;
  }

  async create(tenantId: string, orderId: string, input: CreateReviewInput): Promise<OrderReviewView> {
    if (!isUuidV7(orderId)) throw orderNotFound();
    const createdAt = timeOfId(orderId);

    return this.db.withTenant(tenantId, async (tx) => {
      const orders = await tx.query<{ status: OrderStatus; number: string }>(
        'SELECT status, number FROM orders WHERE tenant_id = $1 AND id = $2 AND created_at = $3',
        [tenantId, orderId, createdAt],
      );
      const order = orders.rows[0];
      if (!order) throw orderNotFound();
      if (order.status !== 'completed') throw new ConflictException({ error: 'review_not_available' });

      // A nota por prato só vale para itens que estão no pedido; nome e produto vêm do pedido, não do cliente.
      const lines = await tx.query<{ line_no: number; product_id: string; product_name: string }>(
        `SELECT line_no, product_id, product_name FROM order_items
          WHERE tenant_id = $1 AND order_id = $2 AND order_created_at = $3`,
        [tenantId, orderId, createdAt],
      );
      const byLine = new Map(lines.rows.map((line) => [line.line_no, line]));
      const itemRatings: ReviewItemRating[] = [];
      for (const item of input.items) {
        const line = byLine.get(item.lineNo);
        if (!line) throw new UnprocessableEntityException({ error: 'review_item_unknown', lineNo: item.lineNo });
        itemRatings.push({
          lineNo: item.lineNo,
          productId: line.product_id,
          productName: line.product_name,
          rating: item.rating,
        });
      }

      const inserted = await tx.query<ReviewRow>(
        `INSERT INTO order_reviews (tenant_id, order_id, order_created_at, rating, comment, item_ratings)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, order_id) DO NOTHING
         RETURNING rating, comment, item_ratings, created_at`,
        [tenantId, orderId, createdAt, input.rating, input.comment || null, JSON.stringify(itemRatings)],
      );
      const review = inserted.rows[0];
      if (!review) throw new ConflictException({ error: 'already_reviewed' });

      await this.outbox.emit(tx, 'review.created', {
        orderId,
        number: Number(order.number),
        rating: input.rating,
        low: input.rating <= LOW_RATING_MAX,
      });
      return toView(review);
    });
  }

  /** Resumo para o painel: média geral, média por prato e as avaliações mais recentes. */
  async summary(tenantId: string): Promise<ReviewsSummaryView> {
    return this.db.withTenant(tenantId, async (tx) => {
      const totals = await tx.query<{ count: string; average: string | null; low: string }>(
        `SELECT count(*) AS count, round(avg(rating), 1) AS average,
                count(*) FILTER (WHERE rating <= $2) AS low
           FROM order_reviews WHERE tenant_id = $1`,
        [tenantId, LOW_RATING_MAX],
      );
      const products = await tx.query<{ product_id: string; product_name: string; average: string; count: string }>(
        `SELECT item->>'productId' AS product_id,
                max(item->>'productName') AS product_name,
                round(avg((item->>'rating')::integer), 1) AS average,
                count(*) AS count
           FROM order_reviews r, jsonb_array_elements(r.item_ratings) AS item
          WHERE r.tenant_id = $1
          GROUP BY item->>'productId'
          ORDER BY average, count DESC
          LIMIT 50`,
        [tenantId],
      );
      const recent = await tx.query<ReviewRow & { order_id: string; number: string; customer_name: string }>(
        `SELECT r.order_id, r.rating, r.comment, r.item_ratings, r.created_at, o.number, c.name AS customer_name
           FROM order_reviews r
           JOIN orders o ON o.tenant_id = r.tenant_id AND o.id = r.order_id AND o.created_at = r.order_created_at
           JOIN customers c ON c.tenant_id = o.tenant_id AND c.id = o.customer_id
          WHERE r.tenant_id = $1
          ORDER BY r.created_at DESC
          LIMIT 100`,
        [tenantId],
      );

      const reviews: PanelReviewView[] = recent.rows.map((row) => ({
        ...toView(row),
        orderId: row.order_id,
        orderNumber: Number(row.number),
        customerName: row.customer_name,
      }));
      const total = totals.rows[0];
      return {
        count: Number(total?.count ?? 0),
        average: total?.average ? Number(total.average) : null,
        lowCount: Number(total?.low ?? 0),
        products: products.rows.map((row) => ({
          productId: row.product_id,
          productName: row.product_name,
          average: Number(row.average),
          count: Number(row.count),
        })),
        reviews,
      };
    });
  }
}

function toView(row: ReviewRow): OrderReviewView {
  return {
    rating: row.rating,
    comment: row.comment,
    items: row.item_ratings,
    createdAt: row.created_at.toISOString(),
  };
}

function orderNotFound(): NotFoundException {
  return new NotFoundException({ error: 'order_not_found' });
}
