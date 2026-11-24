import pg from 'pg';
import { insertDemoMenu } from './dev/demo-data.js';
import { TenantDb } from './platform/db/tenant-db.js';
import { newId } from './platform/ids.js';

/** Cria a loja de demonstração (slug "demo") para desenvolvimento local. Pode rodar mais de uma vez. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL.');
  if (process.env.NODE_ENV === 'production') throw new Error('O seed é só para desenvolvimento.');

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const db = new TenantDb(pool);
    const existing = await db.platformQuery<{ id: string | null }>("SELECT app.resolve_tenant('demo') AS id");
    if (existing.rows[0]?.id) {
      console.log('A loja "demo" já existe. Nada a fazer.');
      return;
    }
    const tenantId = newId();
    await db.platformQuery('SELECT app.create_tenant($1, $2, $3)', [tenantId, 'demo', 'Pizzaria Demo']);
    await db.withTenant(tenantId, insertDemoMenu);
    console.log('Loja "demo" criada. Cardápio em /v1/stores/demo/menu');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
