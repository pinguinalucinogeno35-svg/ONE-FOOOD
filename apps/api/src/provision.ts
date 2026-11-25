import pg from 'pg';

/**
 * Preparo de um ambiente novo (demonstração, homologação): papéis com login e o banco.
 *
 * As migrações criam os papéis da aplicação sem login e não criam o banco nem o papel dono.
 * No desenvolvimento local isso vem de db/dev/init.sql, com senhas fixas. Fora dele, as senhas
 * são as que estão nas URLs de conexão do ambiente, que vêm do cofre de segredos: a URL é a
 * única fonte, então a senha do papel e a senha que a aplicação usa nunca divergem.
 *
 * Tudo aqui pode rodar de novo a cada publicação sem efeito colateral.
 */

interface Credentials {
  user: string;
  password: string;
  database: string;
}

function credentials(url: string, label: string): Credentials {
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!user || !password || !database) throw new Error(`${label}: a URL precisa de usuário, senha e banco.`);
  return { user, password, database };
}

async function withAdmin<T>(adminUrl: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl, application_name: 'onefood-provision' });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Antes das migrações: garante o papel dono das tabelas, com a senha da URL de migração,
 * e o banco. O dono precisa de CREATEROLE porque a primeira migração cria os papéis da
 * aplicação.
 */
export async function provisionOwner(adminUrl: string, migrationUrl: string): Promise<void> {
  const owner = credentials(migrationUrl, 'DATABASE_MIGRATION_URL');
  await withAdmin(adminUrl, async (admin) => {
    const role = admin.escapeIdentifier(owner.user);
    const password = admin.escapeLiteral(owner.password);
    const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [owner.user]);
    await admin.query(
      exists.rowCount
        ? `ALTER ROLE ${role} LOGIN CREATEROLE PASSWORD ${password}`
        : `CREATE ROLE ${role} LOGIN CREATEROLE PASSWORD ${password}`,
    );

    const database = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [owner.database]);
    if (!database.rowCount) {
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(owner.database)} OWNER ${role}`);
    }
  });
}

/**
 * Depois das migrações: os papéis da aplicação (API e workers, relay do outbox) ganham login
 * com a senha da respectiva URL. Só mexe em papel que já existe: quem cria papel é a migração.
 */
export async function provisionLogins(adminUrl: string, loginUrls: string[]): Promise<void> {
  await withAdmin(adminUrl, async (admin) => {
    for (const url of loginUrls) {
      const login = credentials(url, 'URL de conexão da aplicação');
      const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [login.user]);
      if (!exists.rowCount) {
        throw new Error(`O papel "${login.user}" não existe. Ele é criado pelas migrações; confira a URL.`);
      }
      await admin.query(
        `ALTER ROLE ${admin.escapeIdentifier(login.user)} LOGIN PASSWORD ${admin.escapeLiteral(login.password)}`,
      );
    }
  });
}
