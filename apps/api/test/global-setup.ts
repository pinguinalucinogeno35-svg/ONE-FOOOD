import { migrate } from '../src/migrate.js';

/** Deixa o banco de teste na última versão antes de qualquer teste rodar. */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error('DATABASE_MIGRATION_URL não definida para os testes');
  await migrate(url);
}
