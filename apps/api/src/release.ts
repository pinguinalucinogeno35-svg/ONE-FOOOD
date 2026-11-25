import 'reflect-metadata';
import { migrate } from './migrate.js';
import { provisionLogins, provisionOwner } from './provision.js';

/**
 * Passo de publicação: roda uma vez antes de os processos novos subirem.
 *
 *   1. Com DATABASE_ADMIN_URL: garante o papel dono e o banco (ambiente novo).
 *   2. Aplica as migrações pendentes.
 *   3. Com DATABASE_ADMIN_URL: dá login aos papéis da aplicação, com a senha das URLs.
 *   4. Com DEMO_OWNER_EMAIL e DEMO_OWNER_PASSWORD: cria a loja de demonstração, se não existir.
 *
 * Em produção, só o passo 2 roda: os papéis vêm do provisionamento da infraestrutura e não
 * existe loja de demonstração. Se qualquer passo falha, a publicação para e a versão que
 * estava no ar continua.
 */
async function main(): Promise<void> {
  const env = process.env;
  const migrationUrl = env.DATABASE_MIGRATION_URL;
  if (!migrationUrl) throw new Error('Defina DATABASE_MIGRATION_URL (conexão direta, papel dono das tabelas).');
  const adminUrl = env.DATABASE_ADMIN_URL;

  if (adminUrl) {
    await provisionOwner(adminUrl, migrationUrl);
    console.log('papel dono e banco conferidos');
  }

  const result = await migrate(migrationUrl);
  for (const file of result.applied) console.log(`aplicada: ${file}`);
  console.log(`${result.applied.length} migração(ões) aplicada(s), ${result.skipped} já em dia`);

  if (adminUrl) {
    const logins = [env.DATABASE_URL, env.DATABASE_RELAY_URL].filter((url): url is string => Boolean(url));
    await provisionLogins(adminUrl, logins);
    console.log('papéis da aplicação com login');
  }

  const email = env.DEMO_OWNER_EMAIL;
  const password = env.DEMO_OWNER_PASSWORD;
  if (email && password) {
    // Só carrega a aplicação quando há loja de demonstração a criar.
    const { NestFactory } = await import('@nestjs/core');
    const { ApiModule } = await import('./app.modules.js');
    const { seedDemoStore } = await import('./demo-store.js');
    const app = await NestFactory.createApplicationContext(ApiModule, { logger: ['error', 'warn'] });
    try {
      const outcome = await seedDemoStore(app, { email, password });
      console.log(outcome === 'created' ? 'loja de demonstração criada' : 'loja de demonstração já existe');
    } finally {
      await app.close();
    }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error((error as Error).message);
    process.exit(1);
  },
);
