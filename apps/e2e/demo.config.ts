import { defineConfig, devices } from '@playwright/test';

/**
 * Verificação de um ambiente publicado (demonstração): não sobe nada, só abre o endereço em
 * DEMO_URL num navegador e percorre o caminho principal. Uso:
 *
 *   DEMO_URL=https://... DEMO_OWNER_EMAIL=... DEMO_OWNER_PASSWORD=... pnpm test:demo
 */
const DEMO_URL = process.env.DEMO_URL;
if (!DEMO_URL) throw new Error('Defina DEMO_URL com o endereço do site publicado.');

export default defineConfig({
  testDir: './demo',
  outputDir: './test-results-demo',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Folga para o primeiro acesso depois de uma publicação.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: DEMO_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
