import type { INestApplicationContext } from '@nestjs/common';
import { createCouponSchema, createCourierSchema, signupSchema } from '@onefood/shared';
import { insertDemoMenu } from './dev/demo-data.js';
import { CouponsService } from './modules/coupons/index.js';
import { CouriersService } from './modules/delivery/index.js';
import { IdentityService } from './modules/identity/index.js';
import { TenantDb } from './platform/db/tenant-db.js';

export const DEMO_SLUG = 'demo';
export const DEMO_COUPON = 'BEMVINDO10';

export interface DemoOwner {
  email: string;
  password: string;
}

/**
 * Loja de demonstração, para ambientes onde alguém vai abrir o sistema e clicar: o restaurante
 * "demo" com cardápio, um cupom, um entregador e a conta do dono para entrar no painel.
 *
 * Passa pelos mesmos serviços do cadastro de verdade, então o que nasce aqui é o que um
 * restaurante real teria. Se a loja já existe, não faz nada: os dados que a pessoa criou
 * clicando ficam como estão.
 */
export async function seedDemoStore(
  app: INestApplicationContext,
  owner: DemoOwner,
  slug = DEMO_SLUG,
): Promise<'created' | 'exists'> {
  const account = signupSchema.parse({
    name: 'Dono da demonstração',
    email: owner.email,
    password: owner.password,
    storeName: 'Pizzaria Demo',
    storeSlug: slug,
  });
  // Tudo é validado antes de criar a loja: um dado inválido não deixa uma loja pela metade.
  const coupon = createCouponSchema.parse({ code: DEMO_COUPON, kind: 'percent', value: 10 });
  const courier = createCourierSchema.parse({ name: 'Motoboy Demo', phone: '+5511988880001' });

  const db = app.get(TenantDb);
  const resolve = async (): Promise<string | null> => {
    const { rows } = await db.platformQuery<{ id: string | null }>('SELECT app.resolve_tenant($1) AS id', [slug]);
    return rows[0]?.id ?? null;
  };
  if (await resolve()) return 'exists';

  const identity = app.get(IdentityService);
  // O cadastro abre uma sessão; ninguém vai usá-la.
  await identity.logout(await identity.signup(account));
  const tenantId = await resolve();
  if (!tenantId) throw new Error('A loja de demonstração não apareceu depois do cadastro.');

  await db.withTenant(tenantId, insertDemoMenu);
  await app.get(CouponsService).create(tenantId, coupon);
  await app.get(CouriersService).create(tenantId, courier);
  return 'created';
}
