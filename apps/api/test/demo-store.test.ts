import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CouponView, CourierView, MenuView } from '@onefood/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_COUPON, seedDemoStore } from '../src/demo-store.js';
import { newId } from '../src/platform/ids.js';
import { createApiApp, sessionCookie } from './helpers.js';

/** A loja de demonstração nasce pelos mesmos serviços do cadastro de verdade. */
describe('loja de demonstração', () => {
  let app: NestFastifyApplication;
  const unique = newId().replace(/-/g, '').slice(-16);
  const slug = `demo-${unique}`;
  const owner = { email: `demo-${unique}@exemplo.com.br`, password: 'senha-da-demonstracao' };

  beforeAll(async () => {
    app = await createApiApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const login = async (): Promise<string> => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: owner });
    expect(res.statusCode).toBe(200);
    return sessionCookie(res.headers['set-cookie']);
  };

  it('cria a loja com cardápio, cupom, entregador e a conta do dono', async () => {
    expect(await seedDemoStore(app, owner, slug)).toBe('created');

    const menu = (await app.inject({ method: 'GET', url: `/v1/stores/${slug}/menu` })).json<MenuView>();
    expect(menu.store.name).toBe('Pizzaria Demo');
    expect(menu.categories.flatMap((category) => category.products).length).toBeGreaterThanOrEqual(3);

    const cookie = await login();
    const coupons = await app.inject({ method: 'GET', url: `/v1/panel/stores/${slug}/coupons`, headers: { cookie } });
    expect(coupons.json<CouponView[]>().map((coupon) => coupon.code)).toEqual([DEMO_COUPON]);
    const couriers = await app.inject({
      method: 'GET',
      url: `/v1/panel/stores/${slug}/couriers`,
      headers: { cookie },
    });
    expect(couriers.json<CourierView[]>().map((courier) => courier.name)).toEqual(['Motoboy Demo']);
  });

  it('rodar de novo não duplica nada nem mexe no que já existe', async () => {
    expect(await seedDemoStore(app, owner, slug)).toBe('exists');
    // Senha diferente na segunda vez: a conta que já existe continua valendo.
    expect(await seedDemoStore(app, { ...owner, password: 'outra-senha-qualquer' }, slug)).toBe('exists');

    const cookie = await login();
    const couriers = await app.inject({
      method: 'GET',
      url: `/v1/panel/stores/${slug}/couriers`,
      headers: { cookie },
    });
    expect(couriers.json<CourierView[]>()).toHaveLength(1);
  });

  it('recusa senha fraca antes de criar qualquer coisa', async () => {
    const other = `demo-${newId().replace(/-/g, '').slice(-16)}`;
    await expect(seedDemoStore(app, { email: `${other}@exemplo.com.br`, password: 'curta' }, other)).rejects.toThrow();
    expect((await app.inject({ method: 'GET', url: `/v1/stores/${other}/menu` })).statusCode).toBe(404);
  });
});
