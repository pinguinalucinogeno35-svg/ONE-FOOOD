import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Banco e Redis de teste. Os valores padrão batem com o docker compose do repositório;
// defina as variáveis no ambiente para apontar para outro lugar.
const env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://onefood_app:dev_app@127.0.0.1:6432/onefood_test',
  DATABASE_RELAY_URL: 'postgres://onefood_relay:dev_relay@127.0.0.1:6432/onefood_test',
  DATABASE_MIGRATION_URL: 'postgres://onefood_owner:dev_owner@127.0.0.1:5432/onefood_test',
  REDIS_QUEUE_URL: 'redis://127.0.0.1:6379/2',
  REDIS_CACHE_URL: 'redis://127.0.0.1:6379/3',
  REALTIME_TOKEN_SECRET: 'segredo-somente-para-os-testes-automatizados',
};
for (const [key, value] of Object.entries(env)) {
  if (key.startsWith('DATABASE_') || key.startsWith('REDIS_')) process.env[key] ??= value;
  else process.env[key] = value;
}

export default defineConfig({
  resolve: {
    alias: {
      '@onefood/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Os testes de integração dividem o mesmo banco e a mesma fila.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
