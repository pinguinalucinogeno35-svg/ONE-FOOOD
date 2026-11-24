import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OrderView } from '@onefood/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PartitionsService } from '../src/platform/db/partitions.service.js';
import { newId, timeOfId } from '../src/platform/ids.js';
import { createApiApp, createStore, orderBody } from './helpers.js';

describe('particionamento mensal', () => {
  let app: NestFastifyApplication;
  let owner: pg.Client;

  beforeAll(async () => {
    app = await createApiApp();
    owner = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await owner.connect();
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  const partitionsOf = async (table: string): Promise<string[]> => {
    const { rows } = await owner.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = $1::regclass ORDER BY 1`,
      [table],
    );
    return rows.map((row) => row.name);
  };
  const monthSuffix = (offset: number): string => {
    const now = new Date();
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    return `y${date.getUTCFullYear()}m${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  it('mantém criadas as partições do mês atual e dos três seguintes', async () => {
    expect(await app.get(PartitionsService).ensure(3)).toBe(0);
    for (const table of ['orders', 'order_items', 'order_events']) {
      const partitions = await partitionsOf(table);
      for (const offset of [0, 1, 2, 3]) expect(partitions).toContain(`${table}_${monthSuffix(offset)}`);
      expect(partitions).toContain(`${table}_default`);
    }
  });

  it('cria as partições que faltam quando o horizonte aumenta, sem repetir', async () => {
    const service = app.get(PartitionsService);
    await service.ensure(5);
    expect(await partitionsOf('orders')).toContain(`orders_${monthSuffix(5)}`);
    expect(await service.ensure(5)).toBe(0);
  });

  it('o pedido cai na partição do mês e a partição padrão fica vazia', async () => {
    const store = await createStore(app);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${store.slug}/orders`,
      headers: { 'idempotency-key': newId() },
      payload: orderBody(store),
    });
    const order = res.json<OrderView>();

    const { rows } = await owner.query<{ partition: string; created_at: Date }>(
      'SELECT tableoid::regclass::text AS partition, created_at FROM orders WHERE id = $1',
      [order.id],
    );
    expect(rows[0]?.partition).toBe(`orders_${monthSuffix(0)}`);
    expect(rows[0]?.created_at.toISOString()).toBe(timeOfId(order.id).toISOString());

    const strays = await owner.query<{ count: string }>(
      `SELECT (SELECT count(*) FROM orders_default) + (SELECT count(*) FROM order_items_default)
            + (SELECT count(*) FROM order_events_default) AS count`,
    );
    expect(strays.rows[0]?.count).toBe('0');
  });

  it('buscar o pedido pelo id consulta uma única partição', async () => {
    const id = newId();
    const { rows } = await owner.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT 1 FROM orders WHERE tenant_id = '${newId()}' AND id = '${id}'
          AND created_at = '${timeOfId(id).toISOString()}'`,
    );
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
    expect(plan).toContain(`orders_${monthSuffix(0)}`);
    expect(
      plan.match(/orders_y\d{4}m\d{2}|orders_default/g)?.filter((name, i, all) => all.indexOf(name) === i),
    ).toHaveLength(1);
  });

  it('o banco e a aplicação extraem o mesmo instante de um UUID versão 7', async () => {
    const ids = Array.from({ length: 200 }, () => newId());
    const { rows } = await owner.query<{ id: string; at: Date }>(
      'SELECT id::text AS id, app.uuid_v7_time(id) AS at FROM unnest($1::uuid[]) AS id',
      [ids],
    );
    for (const row of rows) expect(row.at.getTime()).toBe(timeOfId(row.id).getTime());
  });
});
