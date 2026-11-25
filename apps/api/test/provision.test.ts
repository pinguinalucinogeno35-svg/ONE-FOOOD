import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrate.js';
import { provisionLogins, provisionOwner } from '../src/provision.js';

/** Preparo de um ambiente novo, contra o Postgres de verdade: papel dono, banco e logins. */
describe('preparo de ambiente novo', () => {
  const adminUrl = process.env.DATABASE_ADMIN_URL as string;
  const unique = randomBytes(6).toString('hex');
  const ownerRole = `prov_owner_${unique}`;
  const loginRole = `prov_login_${unique}`;
  const database = `prov_db_${unique}`;
  let admin: pg.Client;

  const urlFor = (user: string, password: string): string => {
    const url = new URL(adminUrl);
    url.username = user;
    url.password = password;
    url.pathname = `/${database}`;
    return url.toString();
  };
  const whoAmI = async (url: string): Promise<string> => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return (await client.query<{ name: string }>('SELECT current_user AS name')).rows[0]?.name ?? '';
    } finally {
      await client.end();
    }
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
  });
  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${ownerRole}`);
    await admin.query(`DROP ROLE IF EXISTS ${loginRole}`);
    await admin.end();
  });

  it('cria o papel dono e o banco, e as migrações rodam com ele do zero', async () => {
    const ownerUrl = urlFor(ownerRole, 'senha-do-dono-1');
    await provisionOwner(adminUrl, ownerUrl);

    const result = await migrate(ownerUrl);
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.skipped).toBe(0);

    const owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    try {
      const tables = await owner.query<{ owner: string }>(
        "SELECT tableowner AS owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenants'",
      );
      expect(tables.rows[0]?.owner).toBe(ownerRole);
    } finally {
      await owner.end();
    }
  });

  it('pode rodar de novo: mantém o banco e troca a senha pela da URL', async () => {
    const rotated = urlFor(ownerRole, 'senha-do-dono-2');
    await provisionOwner(adminUrl, rotated);

    expect(await whoAmI(rotated)).toBe(ownerRole);
    await expect(whoAmI(urlFor(ownerRole, 'senha-do-dono-1'))).rejects.toThrow(/password authentication failed/);
    // O banco é o mesmo: as migrações já estão todas aplicadas.
    expect((await migrate(rotated)).applied).toEqual([]);
  });

  it('dá login, com a senha da URL, a um papel que a migração criou sem login', async () => {
    await admin.query(`CREATE ROLE ${loginRole} NOLOGIN`);
    const loginUrl = urlFor(loginRole, "senha com espaço e 'aspas'");
    await expect(whoAmI(loginUrl)).rejects.toThrow();

    await provisionLogins(adminUrl, [loginUrl]);
    expect(await whoAmI(loginUrl)).toBe(loginRole);
  });

  it('não cria papel de aplicação: isso é da migração', async () => {
    const unknown = urlFor(`prov_ausente_${unique}`, 'qualquer-senha');
    await expect(provisionLogins(adminUrl, [unknown])).rejects.toThrow(/não existe/);
    const { rowCount } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [`prov_ausente_${unique}`]);
    expect(rowCount).toBe(0);
  });

  it('recusa URL sem senha ou sem banco', async () => {
    await expect(provisionOwner(adminUrl, 'postgres://alguem@127.0.0.1:5432/banco')).rejects.toThrow(/usuário, senha/);
    await expect(provisionOwner(adminUrl, 'postgres://alguem:senha@127.0.0.1:5432')).rejects.toThrow(/usuário, senha/);
  });
});
