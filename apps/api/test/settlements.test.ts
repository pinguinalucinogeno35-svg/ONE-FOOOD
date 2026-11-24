import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  ClosedSettlementView,
  CourierAccessView,
  CourierHomeView,
  OrderView,
  SettlementsView,
} from '@onefood/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/platform/ids.js';
import { createApiApp, orderBody, type PanelStore, sessionCookie, signupStore } from './helpers.js';

const ADDRESS = {
  street: 'Rua das Flores',
  number: '120',
  district: 'Centro',
  city: 'Campinas',
  state: 'SP',
  postalCode: '13010000',
};

/** Loja de teste: refrigerante a 7,00 e taxa de entrega de 6,00. Pedido de 2 refrigerantes = 20,00. */
describe('acerto com o entregador', () => {
  let app: NestFastifyApplication;
  let other: PanelStore;

  beforeAll(async () => {
    app = await createApiApp();
    other = await signupStore(app);
  });
  afterAll(() => app.close());

  const phone = () => `+55119${String(Math.floor(Math.random() * 90000000) + 10000000)}`;
  const panel = (store: PanelStore, method: 'GET' | 'POST' | 'PATCH', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/v1/panel/stores/${store.slug}${path}`,
      payload: payload as object,
      headers: { cookie: store.cookie },
    });
  const createCourier = async (store: PanelStore, name: string, feePerDeliveryCents: number | null = null) =>
    (await panel(store, 'POST', '/couriers', { name, phone: phone(), feePerDeliveryCents })).json<CourierAccessView>();
  /** Faz um pedido de entrega, atribui ao entregador e leva até o estado pedido. */
  const deliver = async (
    store: PanelStore,
    courierId: string | null,
    paymentMethod: 'cash' | 'card_on_delivery' | 'pix',
    until: 'completed' | 'out_for_delivery' | 'cancelled' = 'completed',
    overrides: Record<string, unknown> = {},
  ): Promise<OrderView> => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${store.slug}/orders`,
      headers: { 'idempotency-key': newId() },
      payload: orderBody(store, {
        fulfillment: 'delivery',
        deliveryAddress: ADDRESS,
        paymentMethod,
        customer: { name: 'Cliente', phone: phone() },
        ...overrides,
      }),
    });
    expect(res.statusCode).toBe(201);
    const order = res.json<OrderView>();
    if (courierId) await panel(store, 'POST', `/orders/${order.id}/courier`, { courierId });
    const steps =
      until === 'cancelled'
        ? ['cancelled']
        : ['confirmed', 'preparing', 'ready', 'out_for_delivery', ...(until === 'completed' ? ['completed'] : [])];
    for (const status of steps) {
      const moved = await panel(store, 'POST', `/orders/${order.id}/status`, { status });
      expect(moved.statusCode, status).toBe(200);
    }
    return order;
  };
  const overview = async (store: PanelStore) =>
    (await panel(store, 'GET', '/courier-settlements')).json<SettlementsView>();
  const close = (store: PanelStore, courierId: string, note?: string) =>
    panel(store, 'POST', '/courier-settlements', { courierId, note });

  it('soma o que o entregador tem a receber e o dinheiro que recebeu em mãos', async () => {
    const store = await signupStore(app);
    const joao = await createCourier(store, 'João');
    await deliver(store, joao.id, 'cash');
    await deliver(store, joao.id, 'cash');
    await deliver(store, joao.id, 'card_on_delivery');
    await deliver(store, joao.id, 'pix');

    const { pending, recent } = await overview(store);
    expect(recent).toEqual([]);
    expect(pending).toHaveLength(1);
    // 4 entregas a 6,00 de taxa; só os 2 pedidos em dinheiro (20,00 cada) passam pela mão dele.
    expect(pending[0]).toMatchObject({
      courierId: joao.id,
      courierName: 'João',
      deliveries: 4,
      feesCents: 2400,
      cashCents: 4000,
    });
    expect(Date.now() - Date.parse(pending[0]?.since ?? '')).toBeLessThan(60_000);

    // O entregador vê o mesmo na página dele.
    const home = await app.inject({
      method: 'GET',
      url: '/v1/courier/deliveries',
      headers: { authorization: `Bearer ${joao.accessToken}` },
    });
    expect(home.json<CourierHomeView>().settlement).toEqual({ deliveries: 4, feesCents: 2400, cashCents: 4000 });
  });

  it('com valor fixo por entrega, a taxa cobrada do cliente não entra na conta do entregador', async () => {
    const store = await signupStore(app);
    const fixo = await createCourier(store, 'Fixo', 450);
    await deliver(store, fixo.id, 'cash');
    await deliver(store, fixo.id, 'card_on_delivery');
    expect((await overview(store)).pending[0]).toMatchObject({ deliveries: 2, feesCents: 900, cashCents: 2000 });

    // Mudar a regra muda o que ainda está pendente.
    expect((await panel(store, 'PATCH', `/couriers/${fixo.id}`, { feePerDeliveryCents: null })).statusCode).toBe(204);
    expect((await overview(store)).pending[0]).toMatchObject({ feesCents: 1200 });
    expect((await panel(store, 'PATCH', `/couriers/${fixo.id}`, { feePerDeliveryCents: -1 })).statusCode).toBe(400);
  });

  it('só conta entrega concluída, de cada entregador separadamente', async () => {
    const store = await signupStore(app);
    const ana = await createCourier(store, 'Ana');
    const bia = await createCourier(store, 'Bia');
    await deliver(store, ana.id, 'cash');
    await deliver(store, ana.id, 'cash', 'out_for_delivery');
    await deliver(store, ana.id, 'cash', 'cancelled');
    await deliver(store, bia.id, 'card_on_delivery');
    // Concluída sem entregador: não é de ninguém.
    await deliver(store, null, 'cash');

    const { pending } = await overview(store);
    expect(pending.map((item) => [item.courierName, item.deliveries, item.feesCents, item.cashCents])).toEqual([
      ['Ana', 1, 600, 2000],
      ['Bia', 1, 600, 0],
    ]);
  });

  it('fechar o acerto grava os totais, zera o pendente e entra no histórico', async () => {
    const store = await signupStore(app);
    const leo = await createCourier(store, 'Leo');
    await deliver(store, leo.id, 'cash');
    await deliver(store, leo.id, 'card_on_delivery');

    const closed = await close(store, leo.id, '  conferido no caixa  ');
    expect(closed.statusCode).toBe(201);
    expect(closed.json<ClosedSettlementView>()).toMatchObject({
      courierId: leo.id,
      courierName: 'Leo',
      deliveries: 2,
      feesCents: 1200,
      cashCents: 2000,
      note: 'conferido no caixa',
    });

    const after = await overview(store);
    expect(after.pending).toEqual([]);
    expect(after.recent).toHaveLength(1);
    expect(after.recent[0]).toMatchObject({ id: closed.json<ClosedSettlementView>().id, deliveries: 2 });

    // Nada a acertar: não cria acerto vazio.
    const again = await close(store, leo.id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'nothing_to_settle' });

    // Entrega nova depois do fechamento começa outro acerto, sem recontar as antigas.
    await deliver(store, leo.id, 'cash');
    expect((await overview(store)).pending[0]).toMatchObject({ deliveries: 1, feesCents: 600, cashCents: 2000 });
    expect((await close(store, leo.id)).json<ClosedSettlementView>()).toMatchObject({ deliveries: 1 });
    expect((await overview(store)).recent.map((item) => item.deliveries)).toEqual([1, 2]);
  });

  it('acerto fechado guarda os valores do dia, mesmo se a regra do entregador mudar depois', async () => {
    const store = await signupStore(app);
    const rui = await createCourier(store, 'Rui', 500);
    await deliver(store, rui.id, 'cash');
    await close(store, rui.id);
    await panel(store, 'PATCH', `/couriers/${rui.id}`, { feePerDeliveryCents: 900 });
    expect((await overview(store)).recent[0]).toMatchObject({ feesCents: 500 });
  });

  it('dois fechamentos ao mesmo tempo não contam a mesma entrega duas vezes', async () => {
    const store = await signupStore(app);
    const caio = await createCourier(store, 'Caio');
    for (let i = 0; i < 3; i++) await deliver(store, caio.id, 'cash');

    const responses = await Promise.all(Array.from({ length: 6 }, () => close(store, caio.id)));
    const statuses = responses.map((res) => res.statusCode).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    const { recent, pending } = await overview(store);
    expect(pending).toEqual([]);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ deliveries: 3, feesCents: 1800, cashCents: 6000 });
  });

  it('exige sessão, vínculo e papel; entregador de outra loja não existe', async () => {
    const store = await signupStore(app);
    const mine = await createCourier(store, 'Meu');
    const foreign = await createCourier(other, 'Estranho');
    await deliver(store, mine.id, 'cash');
    const url = `/v1/panel/stores/${store.slug}/courier-settlements`;

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    expect((await close(store, foreign.id)).statusCode).toBe(404);
    expect((await close(store, newId())).statusCode).toBe(404);
    expect((await panel(store, 'POST', '/courier-settlements', { courierId: 'x' })).statusCode).toBe(400);
    // O acerto de uma loja não aparece na outra.
    expect((await overview(other)).pending.map((item) => item.courierId)).not.toContain(mine.id);

    // Funcionário vê o acerto mas não fecha.
    const staff = await signupStore(app, false);
    const owner = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
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
    const denied = await app.inject({ method: 'POST', url, headers: { cookie }, payload: { courierId: mine.id } });
    expect(denied.statusCode).toBe(403);
    expect((await overview(store)).pending).toHaveLength(1);
  });
});
