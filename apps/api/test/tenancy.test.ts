import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantDb } from '../src/platform/db/tenant-db.js';
import { newId } from '../src/platform/ids.js';
import { APP_POOL, RELAY_POOL } from '../src/platform/tokens.js';
import { createApiApp, createStore, type TestStore } from './helpers.js';

describe('isolamento entre tenants (Row Level Security)', () => {
  let app: NestFastifyApplication;
  let db: TenantDb;
  let pool: Pool;
  let a: TestStore;
  let b: TestStore;

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get(TenantDb);
    pool = app.get<Pool>(APP_POOL);
    a = await createStore(app);
    b = await createStore(app);
  });
  afterAll(() => app.close());

  it('a aplicação não conecta como dona das tabelas nem ignora o RLS', async () => {
    const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean; owns: string }>(
      `SELECT r.rolsuper, r.rolbypassrls,
              (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user) AS owns
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owns: '0' });
  });

  it('toda tabela de negócio tem tenant_id e RLS ligado', async () => {
    const { rows } = await pool.query<{ name: string; rls: boolean; has_tenant: boolean }>(
      `SELECT c.relname AS name, c.relrowsecurity AS rls,
              EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS has_tenant
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
          AND c.relname NOT IN ('schema_migrations', 'tenants')`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(rows.filter((row) => !row.rls || !row.has_tenant)).toEqual([]);
  });

  it('sem contexto de tenant nenhuma linha aparece', async () => {
    for (const table of ['tenants', 'products', 'menu_categories', 'customers', 'orders', 'payments']) {
      const { rows } = await pool.query<{ count: string }>(`SELECT count(*) AS count FROM ${table}`);
      expect(rows[0]?.count, table).toBe('0');
    }
  });

  it('um tenant só enxerga os próprios dados, mesmo pedindo os do outro pelo id', async () => {
    const seenByA = await db.withTenant(a.tenantId, (tx) =>
      tx.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM products'),
    );
    expect(seenByA.rows).toEqual([{ tenant_id: a.tenantId }]);

    const stolen = await db.withTenant(a.tenantId, (tx) =>
      tx.query('SELECT 1 FROM products WHERE id = $1', [b.menu.margherita]),
    );
    expect(stolen.rowCount).toBe(0);

    const tenants = await db.withTenant(a.tenantId, (tx) => tx.query<{ id: string }>('SELECT id FROM tenants'));
    expect(tenants.rows).toEqual([{ id: a.tenantId }]);
  });

  it('não grava nem altera dados de outro tenant', async () => {
    await expect(
      db.withTenant(a.tenantId, (tx) =>
        tx.query("INSERT INTO menu_categories (tenant_id, id, name) VALUES ($1, $2, 'Invasão')", [b.tenantId, newId()]),
      ),
    ).rejects.toThrow(/row-level security/);

    const updated = await db.withTenant(a.tenantId, (tx) =>
      tx.query('UPDATE products SET price_cents = 1 WHERE id = $1', [b.menu.margherita]),
    );
    expect(updated.rowCount).toBe(0);

    const intact = await db.withTenant(b.tenantId, (tx) =>
      tx.query<{ price_cents: number }>('SELECT price_cents FROM products WHERE id = $1', [b.menu.margherita]),
    );
    expect(intact.rows[0]?.price_cents).toBe(4500);
  });

  it('o contexto não vaza para a próxima transação na mesma conexão do pool', async () => {
    // Pool de uma conexão só: a segunda consulta reutiliza a conexão da primeira.
    const pg = await import('pg');
    const single = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      const scoped = new TenantDb(single);
      const inside = await scoped.withTenant(a.tenantId, (tx) => tx.query('SELECT 1 FROM products'));
      expect(inside.rowCount).toBeGreaterThan(0);

      const after = await single.query<{ tenant: string | null; visible: string }>(
        'SELECT app.current_tenant_id()::text AS tenant, (SELECT count(*) FROM products) AS visible',
      );
      expect(after.rows[0]).toEqual({ tenant: null, visible: '0' });

      await expect(
        scoped.withTenant(a.tenantId, async () => {
          throw new Error('falha no meio');
        }),
      ).rejects.toThrow('falha no meio');
      const afterFailure = await single.query<{ visible: string }>('SELECT count(*) AS visible FROM products');
      expect(afterFailure.rows[0]?.visible).toBe('0');
    } finally {
      await single.end();
    }
  });

  it('o papel do relay só alcança o outbox', async () => {
    const relay = app.get<Pool>(RELAY_POOL);
    await expect(relay.query('SELECT 1 FROM orders LIMIT 1')).rejects.toThrow(/permission denied/);
    await expect(relay.query('SELECT 1 FROM customers LIMIT 1')).rejects.toThrow(/permission denied/);
    await expect(relay.query('SELECT 1 FROM outbox LIMIT 1')).resolves.toBeDefined();
  });

  it('a aplicação não lê o outbox nem apaga pedidos', async () => {
    await expect(db.withTenant(a.tenantId, (tx) => tx.query('SELECT 1 FROM outbox'))).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.withTenant(a.tenantId, (tx) => tx.query('DELETE FROM orders'))).rejects.toThrow(
      /permission denied/,
    );
  });
});
