import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiModule } from '../src/app.modules.js';
import { type DemoMenu, insertDemoMenu } from '../src/dev/demo-data.js';
import { TenantDb } from '../src/platform/db/tenant-db.js';
import { newId } from '../src/platform/ids.js';
import { TenantsService } from '../src/platform/tenants/tenants.service.js';

export async function createApiApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(ApiModule, new FastifyAdapter(), { logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export interface TestStore {
  tenantId: string;
  slug: string;
  menu: DemoMenu;
}

/** Cada teste cria a própria loja: os testes não dependem uns dos outros nem de limpeza. */
export async function createStore(app: INestApplicationContext, withMenu = true): Promise<TestStore> {
  const tenantId = newId();
  const slug = `loja-${tenantId.replace(/-/g, '').slice(-16)}`;
  await app.get(TenantsService).create({ id: tenantId, slug, name: `Loja ${slug}` });
  const menu = withMenu ? await app.get(TenantDb).withTenant(tenantId, insertDemoMenu) : ({} as DemoMenu);
  return { tenantId, slug, menu };
}

export function orderBody(store: TestStore, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customer: { name: 'Maria Souza', phone: '+5511999990000' },
    fulfillment: 'pickup',
    paymentMethod: 'pix',
    items: [{ productId: store.menu.refrigerante, quantity: 2 }],
    ...overrides,
  };
}

export async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('condição não atingida a tempo');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
