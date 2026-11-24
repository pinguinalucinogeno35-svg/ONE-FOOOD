import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CouponView, OrderView } from '@onefood/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CouponsService } from '../src/modules/coupons/index.js';
import { TenantDb } from '../src/platform/db/tenant-db.js';
import { newId, timeOfId } from '../src/platform/ids.js';
import { createApiApp, orderBody, type PanelStore, sessionCookie, signupStore } from './helpers.js';

describe('cupons', () => {
  let app: NestFastifyApplication;
  let store: PanelStore;
  let other: PanelStore;

  beforeAll(async () => {
    app = await createApiApp();
    store = await signupStore(app);
    other = await signupStore(app);
  });
  afterAll(() => app.close());

  const code = () => `C${newId().replace(/-/g, '').slice(-10).toUpperCase()}`;
  const createCoupon = async (fields: Record<string, unknown>, as: PanelStore = store) => {
    const body = { code: code(), kind: 'percent', value: 10, ...fields };
    const res = await app.inject({
      method: 'POST',
      url: `/v1/panel/stores/${as.slug}/coupons`,
      payload: body,
      headers: { cookie: as.cookie },
    });
    return { res, code: String(body.code).replace(/\s/g, '').toUpperCase() };
  };
  const coupons = async () =>
    (
      await app.inject({
        method: 'GET',
        url: `/v1/panel/stores/${store.slug}/coupons`,
        headers: { cookie: store.cookie },
      })
    ).json<CouponView[]>();
  // 2 refrigerantes a 7,00 = 14,00 de itens.
  const order = (couponCode: string | undefined, overrides: Record<string, unknown> = {}, slug = store.slug) =>
    app.inject({
      method: 'POST',
      url: `/v1/stores/${slug}/orders`,
      headers: { 'idempotency-key': newId() },
      payload: orderBody(store, { couponCode, ...overrides }),
    });
  const phone = () => `+55119${String(Math.floor(Math.random() * 90000000) + 10000000)}`;
  const preview = (couponCode: string, subtotalCents: number, slug = store.slug) =>
    app.inject({
      method: 'POST',
      url: `/v1/stores/${slug}/coupons/preview`,
      payload: { code: couponCode, subtotalCents },
    });

  it('cupom percentual desconta dos itens, não da entrega', async () => {
    const { res, code: couponCode } = await createCoupon({ value: 10 });
    expect(res.statusCode).toBe(201);

    const placed = await order(couponCode.toLowerCase(), {
      fulfillment: 'delivery',
      deliveryAddress: {
        street: 'Rua A',
        number: '1',
        district: 'Centro',
        city: 'Campinas',
        state: 'SP',
        postalCode: '13010000',
      },
    });
    expect(placed.statusCode).toBe(201);
    expect(placed.json<OrderView>()).toMatchObject({
      subtotalCents: 1400,
      deliveryFeeCents: 600,
      discountCents: 140,
      totalCents: 1860,
      couponCode,
    });

    const rows = await app.get(TenantDb).withTenant(store.tenantId, async (tx) => ({
      payment: (await tx.query('SELECT amount_cents FROM payments WHERE order_id = $1', [placed.json<OrderView>().id]))
        .rows[0],
      redemption: (
        await tx.query('SELECT discount_cents FROM coupon_redemptions WHERE order_id = $1', [
          placed.json<OrderView>().id,
        ])
      ).rows[0],
    }));
    // A cobrança é do total já com desconto.
    expect(rows).toEqual({ payment: { amount_cents: 1860 }, redemption: { discount_cents: 140 } });
    expect((await coupons()).find((coupon) => coupon.code === couponCode)?.redemptions).toBe(1);
  });

  it('cupom de valor fixo, com teto no percentual e nunca maior que os itens', async () => {
    const fixed = await createCoupon({ kind: 'fixed', value: 500 });
    expect((await order(fixed.code)).json<OrderView>()).toMatchObject({ discountCents: 500, totalCents: 900 });

    const huge = await createCoupon({ kind: 'fixed', value: 99_900 });
    expect((await order(huge.code)).json<OrderView>()).toMatchObject({ discountCents: 1400, totalCents: 0 });

    const capped = await createCoupon({ value: 50, maxDiscountCents: 300 });
    expect((await order(capped.code)).json<OrderView>()).toMatchObject({ discountCents: 300, totalCents: 1100 });
  });

  it('recusa o pedido quando o cupom não vale, dizendo o motivo, e não cria nada', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const cases: Array<[string, string]> = [
      ['NAOEXISTE', 'not_found'],
      [(await createCoupon({ startsAt: future })).code, 'not_started'],
      [(await createCoupon({ endsAt: past })).code, 'expired'],
      [(await createCoupon({ minOrderCents: 5000 })).code, 'min_order'],
    ];
    const inactive = await createCoupon({});
    const created = inactive.res.json<{ id: string }>();
    await app.inject({
      method: 'PATCH',
      url: `/v1/panel/stores/${store.slug}/coupons/${created.id}`,
      payload: { active: false },
      headers: { cookie: store.cookie },
    });
    cases.push([inactive.code, 'inactive']);

    const before = await app
      .get(TenantDb)
      .withTenant(store.tenantId, (tx) => tx.query<{ count: string }>('SELECT count(*) AS count FROM orders'));
    for (const [couponCode, problem] of cases) {
      const res = await order(couponCode);
      expect(res.statusCode, problem).toBe(422);
      expect(res.json()).toEqual({ error: 'coupon_invalid', problem });
    }
    const after = await app
      .get(TenantDb)
      .withTenant(store.tenantId, (tx) => tx.query<{ count: string }>('SELECT count(*) AS count FROM orders'));
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it('um cupom por cliente: o mesmo telefone não usa duas vezes, outro telefone usa', async () => {
    const { code: couponCode } = await createCoupon({});
    const customer = { name: 'Lia', phone: phone() };
    expect((await order(couponCode, { customer })).statusCode).toBe(201);
    const again = await order(couponCode, { customer });
    expect(again.statusCode).toBe(422);
    expect(again.json()).toMatchObject({ problem: 'already_used' });
    expect((await order(couponCode, { customer: { name: 'Rui', phone: phone() } })).statusCode).toBe(201);

    const reusable = await createCoupon({ oncePerCustomer: false });
    expect((await order(reusable.code, { customer })).statusCode).toBe(201);
    expect((await order(reusable.code, { customer })).statusCode).toBe(201);
  });

  it('com limite de usos, pedidos simultâneos nunca passam do limite', async () => {
    const { code: couponCode } = await createCoupon({ maxRedemptions: 3 });
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => order(couponCode, { customer: { name: 'Fila', phone: phone() } })),
    );
    const statuses = responses.map((res) => res.statusCode);
    expect(statuses.filter((status) => status === 201)).toHaveLength(3);
    expect(statuses.filter((status) => status === 422)).toHaveLength(9);
    expect(responses.find((res) => res.statusCode === 422)?.json()).toMatchObject({ problem: 'exhausted' });
    expect((await coupons()).find((coupon) => coupon.code === couponCode)?.redemptions).toBe(3);
  });

  it('a trava do cupom segura o limite mesmo fora da fila de pedidos da loja', async () => {
    // A criação de pedidos já anda em fila por loja (contador do número do pedido), o que
    // esconderia uma falha aqui. Este teste chama o resgate direto, em transações simultâneas.
    const { code: couponCode } = await createCoupon({ maxRedemptions: 3, oncePerCustomer: false });
    const db = app.get(TenantDb);
    const service = app.get(CouponsService);

    const orders: OrderView[] = [];
    for (let i = 0; i < 8; i++)
      orders.push((await order(undefined, { customer: { name: 'Fila', phone: phone() } })).json<OrderView>());
    const customers = await db.withTenant(store.tenantId, (tx) =>
      tx.query<{ id: string; customer_id: string }>('SELECT id, customer_id FROM orders WHERE id = ANY($1::uuid[])', [
        orders.map((placed) => placed.id),
      ]),
    );
    const customerOf = new Map(customers.rows.map((row) => [row.id, row.customer_id]));

    const results = await Promise.allSettled(
      orders.map((placed) =>
        db.withTenant(store.tenantId, async (tx) => {
          // Dá tempo de todas as transações lerem o cupom antes de qualquer uma gravar.
          await tx.query('SELECT pg_sleep(0.05)');
          return service.redeem(tx, {
            code: couponCode,
            customerId: customerOf.get(placed.id) as string,
            subtotalCents: placed.subtotalCents,
            orderId: placed.id,
            orderCreatedAt: timeOfId(placed.id),
          });
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    const rejected = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(5);
    for (const result of rejected) expect(result.reason).toMatchObject({ problem: 'exhausted' });
    expect((await coupons()).find((coupon) => coupon.code === couponCode)?.redemptions).toBe(3);
  });

  it('cancelar o pedido devolve o uso do cupom', async () => {
    const { code: couponCode } = await createCoupon({ maxRedemptions: 1 });
    const customer = { name: 'Téo', phone: phone() };
    const placed = (await order(couponCode, { customer })).json<OrderView>();
    expect((await order(couponCode, { customer: { name: 'Ivo', phone: phone() } })).statusCode).toBe(422);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/panel/stores/${store.slug}/orders/${placed.id}/status`,
      payload: { status: 'cancelled' },
      headers: { cookie: store.cookie },
    });
    expect(cancelled.statusCode).toBe(200);
    expect((await coupons()).find((coupon) => coupon.code === couponCode)?.redemptions).toBe(0);
    // O mesmo cliente, que tinha usado, pode usar de novo.
    expect((await order(couponCode, { customer })).statusCode).toBe(201);
  });

  it('repetir o envio com a mesma chave não gasta o cupom duas vezes', async () => {
    const { code: couponCode } = await createCoupon({});
    const key = newId();
    const send = () =>
      app.inject({
        method: 'POST',
        url: `/v1/stores/${store.slug}/orders`,
        headers: { 'idempotency-key': key },
        payload: orderBody(store, { couponCode, customer: { name: 'Eco', phone: '+5511977776666' } }),
      });
    const [first, second] = [await send(), await send()];
    expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
    expect(second.json()).toEqual(first.json());
    expect((await coupons()).find((coupon) => coupon.code === couponCode)?.redemptions).toBe(1);
  });

  it('a prévia mostra o desconto sem gastar o cupom', async () => {
    const { code: couponCode } = await createCoupon({ value: 20, maxRedemptions: 1 });
    for (let i = 0; i < 3; i++) {
      const res = await preview(` ${couponCode.toLowerCase()} `, 5000);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ code: couponCode, discountCents: 1000 });
    }
    expect((await coupons()).find((coupon) => coupon.code === couponCode)?.redemptions).toBe(0);

    const missing = await preview('NAOEXISTE', 5000);
    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toEqual({ error: 'coupon_invalid', problem: 'not_found' });
  });

  it('cupom de uma loja não vale em outra', async () => {
    const { code: couponCode } = await createCoupon({});
    expect((await preview(couponCode, 5000, other.slug)).statusCode).toBe(422);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${other.slug}/orders`,
      headers: { 'idempotency-key': newId() },
      payload: orderBody(other, { couponCode }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ problem: 'not_found' });
  });

  it('valida a criação e recusa código repetido na mesma loja', async () => {
    const taken = await createCoupon({});
    const repeated = await createCoupon({ code: taken.code });
    expect(repeated.res.statusCode).toBe(409);
    expect(repeated.res.json()).toMatchObject({ error: 'coupon_code_taken' });
    // Em outra loja o mesmo código é livre.
    expect((await createCoupon({ code: taken.code }, other)).res.statusCode).toBe(201);

    const invalid: Array<Record<string, unknown>> = [
      { code: 'AB' },
      { code: 'COM-TRACO' },
      { value: 0 },
      { value: 101 },
      { kind: 'fixed', value: 10.5 },
      { kind: 'brinde' },
      { startsAt: '2026-12-10T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' },
      { maxRedemptions: 0 },
    ];
    for (const fields of invalid) {
      expect((await createCoupon(fields)).res.statusCode, JSON.stringify(fields)).toBe(400);
    }
  });

  it('exige sessão e vínculo; funcionário vê mas não cria', async () => {
    const url = `/v1/panel/stores/${store.slug}/coupons`;
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url, headers: { cookie: other.cookie } })).statusCode).toBe(404);

    const staff = await signupStore(app, false);
    const pg = await import('pg');
    const owner = new pg.default.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await owner.connect();
    await owner.query(
      "INSERT INTO memberships (tenant_id, user_id, role) SELECT $1, id, 'staff' FROM users WHERE email = $2",
      [store.tenantId, staff.email],
    );
    await owner.end();
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: staff.email, password: staff.password },
    });
    const cookie = sessionCookie(login.headers['set-cookie']);
    expect((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode).toBe(200);
    const denied = await app.inject({
      method: 'POST',
      url,
      headers: { cookie },
      payload: { code: code(), kind: 'percent', value: 10 },
    });
    expect(denied.statusCode).toBe(403);
  });
});
