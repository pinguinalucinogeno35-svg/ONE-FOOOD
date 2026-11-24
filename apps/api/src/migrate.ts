import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
/** db/migrations fica na raiz do repositório (e em /app/db/migrations na imagem). */
const DEFAULT_DIR = resolve(here, process.env.MIGRATIONS_DIR ?? '../../../db/migrations');
const LOCK_KEY = 7_316_001;

export interface MigrationResult {
  applied: string[];
  skipped: number;
}

/**
 * Aplica as migrações SQL pendentes, em ordem, uma transação por arquivo.
 *
 * - Conecta direto ao Postgres como dono das tabelas (nunca pelo PgBouncer).
 * - Trava consultiva: dois deploys simultâneos não migram ao mesmo tempo.
 * - lock_timeout curto: uma migração que não consegue o bloqueio falha rápido em vez de
 *   enfileirar atrás dela todas as consultas da aplicação no meio do jantar.
 * - Migração já aplicada não pode ser editada: o conteúdo é conferido por hash.
 */
export async function migrate(connectionString: string, directory = DEFAULT_DIR): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString, application_name: 'onefood-migrate' });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const files = (await readdir(directory)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
    const done = new Map(
      (
        await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations')
      ).rows.map((row) => [row.version, row.checksum]),
    );

    const applied: string[] = [];
    for (const file of files) {
      const sql = await readFile(join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = done.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(`${file} foi alterada depois de aplicada. Crie uma nova migração em vez de editar.`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`falha em ${file}: ${(error as Error).message}`, { cause: error });
      }
      applied.push(file);
    }
    return { applied, skipped: files.length - applied.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

const isCli = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    console.error('Defina DATABASE_MIGRATION_URL (conexão direta, papel dono das tabelas).');
    process.exit(1);
  }
  migrate(url).then(
    (result) => {
      for (const file of result.applied) console.log(`aplicada: ${file}`);
      console.log(`${result.applied.length} aplicada(s), ${result.skipped} já em dia.`);
    },
    (error) => {
      console.error((error as Error).message);
      process.exit(1);
    },
  );
}
