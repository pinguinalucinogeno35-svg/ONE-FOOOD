// Sobe o sistema inteiro para os testes de ponta a ponta: migrações, API, workers,
// tempo real e o site, a partir do que `pnpm build` gerou. O Playwright chama este script
// e espera o site responder. Precisa de Postgres, PgBouncer e Redis no ar (`pnpm services:up`).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const apiDir = `${root}apps/api`;
const webDir = `${root}apps/web`;

// Portas próprias, para não disputar com um ambiente de desenvolvimento aberto.
export const PORTS = { api: 3210, realtime: 3211, web: 3212 };

const env = {
  ...process.env,
  NODE_ENV: 'development',
  LOG_LEVEL: 'warn',
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://onefood_app:dev_app@127.0.0.1:6432/onefood_dev',
  DATABASE_RELAY_URL:
    process.env.E2E_DATABASE_RELAY_URL ?? 'postgres://onefood_relay:dev_relay@127.0.0.1:6432/onefood_dev',
  DATABASE_MIGRATION_URL:
    process.env.E2E_DATABASE_MIGRATION_URL ?? 'postgres://onefood_owner:dev_owner@127.0.0.1:5432/onefood_dev',
  REDIS_QUEUE_URL: process.env.E2E_REDIS_QUEUE_URL ?? 'redis://127.0.0.1:6379/4',
  REDIS_CACHE_URL: process.env.E2E_REDIS_CACHE_URL ?? 'redis://127.0.0.1:6379/5',
  REALTIME_TOKEN_SECRET: 'segredo-somente-para-os-testes-de-ponta-a-ponta',
  PORT: String(PORTS.api),
  REALTIME_PORT: String(PORTS.realtime),
  REALTIME_PUBLIC_URL: `ws://localhost:${PORTS.realtime}/ws`,
  WEB_ORIGIN: `http://localhost:${PORTS.web}`,
  API_URL: `http://localhost:${PORTS.api}`,
  // Todos os testes saem do mesmo IP.
  SIGNUP_LIMIT_PER_IP_HOUR: '0',
  ORDER_LIMIT_PER_IP_10MIN: '0',
};

const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}

function start(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(child);
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`[e2e] ${name} encerrou sozinho (código ${code}).`);
    stop(1);
  });
  return child;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} saiu com ${code}`))));
  });
}

async function waitFor(url, label) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // ainda subindo
    }
    if (Date.now() > deadline) throw new Error(`${label} não respondeu em ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

try {
  if (!existsSync(`${apiDir}/dist/main.api.js`) || !existsSync(`${webDir}/.next/BUILD_ID`)) {
    throw new Error('Falta o build. Rode `pnpm build` antes dos testes de ponta a ponta.');
  }
  await run('node', ['dist/migrate.js'], apiDir);

  start('api', 'node', ['dist/main.api.js'], apiDir);
  start('workers', 'node', ['dist/main.worker.js'], apiDir);
  start('tempo real', 'node', ['dist/main.realtime.js'], apiDir);
  await waitFor(`http://localhost:${PORTS.api}/health/ready`, 'API');
  await waitFor(`http://localhost:${PORTS.realtime}/health/live`, 'tempo real');

  // O site sobe por último: é ele que o Playwright espera.
  start('site', 'node', ['node_modules/next/dist/bin/next', 'start', '--port', String(PORTS.web)], webDir);
} catch (error) {
  console.error(`[e2e] ${error.message}`);
  stop(1);
}
