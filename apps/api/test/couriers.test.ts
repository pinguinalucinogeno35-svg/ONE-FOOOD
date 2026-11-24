import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  CourierAccessView,
  CourierHomeView,
  CourierView,
  OrderView,
  PanelOrderView,
  TrackedOrderView,
} from '@onefood/shared';
import type { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantDb } from '../src/platform/db/tenant-db.js';
import { newId } from '../src/platform/ids.js';
import { REDIS_CACHE } from '../src/platform/tokens.js';
import { createApiApp, orderBody, type PanelStore, signupStore } from './helpers.js';

const ADDRESS = {
  street: 'Rua das Flores',
  number: '120',
  district: 'Centro',
  city: 'Campinas',
  state: 'SP',
  postalCode: '13010000',
};

describe('entregadores', () => {
  let app: NestFastifyApplication;
  let owner: pg.Client;
  let store: PanelStore;
  let other: PanelStore;

  beforeAll(async () => {
    app = await createApiApp();
    owner = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await owner.connect();
    store = await signupStore(app);
    other = await signupStore(app);
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  const phone = () => `+55119${String(Math.floor(Math.random() * 90000000) + 10000000)}`;
  const panel = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: unknown, as: PanelStore = store) =>
    app.inject({
      method,
      url: `/v1/panel/stores/${as.slug}${path}`,
      payload: payload as object,
      headers: { cookie: as.cookie },
    });
  const createCourier = async (name = 'João Batista', as: PanelStore = store): Promise<CourierAccessView> => {
    const res = await panel('POST', '/couriers', { name, phone: phone() }, as);
    expect(res.statusCode).toBe(201);
    return res.json<CourierAccessView>();
  };
  const asCourier = (token: string | null, method: 'GET' | 'POST', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/v1/courier${path}`,
      payload: payload as object,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const deliveries = async (token: string) => (await asCourier(token, 'GET', '/deliveries')).json<CourierHomeView>();
  const placeOrder = async (
    overrides: Record<string, unknown> = {},
    target: PanelStore = store,
  ): Promise<OrderView> => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${target.slug}/orders`,
      headers: { 'idempotency-key': newId() },
      payload: orderBody(target, {
        fulfillment: 'delivery',
        deliveryAddress: ADDRESS,
        paymentMethod: 'cash',
        customer: { name: 'Carla Dias', phone: phone() },
        ...overrides,
      }),
    });
    expect(res.statusCode).toBe(201);
    return res.json<OrderView>();
  };
  const setStatus = (orderId: string, ...statuses: string[]) =>
    statuses.reduce(
      async (previous, status) => {
        await previous;
        const res = await panel('POST', `/orders/${orderId}/status`, { status });
        expect(res.statusCode, status).toBe(200);
      },
      Promise.resolve() as Promise<void>,
    );
  const assign = (orderId: string, courierId: string | null, as: PanelStore = store) =>
    panel('POST', `/orders/${orderId}/courier`, { courierId }, as);
  const track = async (orderId: string) =>
    (await app.inject({ method: 'GET', url: `/v1/stores/${store.slug}/orders/${orderId}` })).json<TrackedOrderView>();

  describe('cadastro e link de acesso', () => {
    it('cadastra o entregador e o link dá acesso só às entregas dele', async () => {
      const courier = await createCourier('João Batista');
      expect(courier.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const listed = (await panel('GET', '/couriers')).json<CourierView[]>();
      expect(listed.find((item) => item.id === courier.id)).toMatchObject({
        name: 'João Batista',
        active: true,
        feePerDeliveryCents: null,
      });

      const home = await asCourier(courier.accessToken, 'GET', '/deliveries');
      expect(home.statusCode).toBe(200);
      expect(home.json()).toEqual({
        courier: { name: 'João Batista' },
        store: { name: `Loja ${store.slug}` },
        deliveries: [],
        settlement: { deliveries: 0, feesCents: 0, cashCents: 0 },
      });
    });

    it('o banco guarda só o hash do token', async () => {
      const courier = await createCourier();
      const { rows } = await owner.query<{ access_token_hash: string }>(
        'SELECT access_token_hash FROM couriers WHERE id = $1',
        [courier.id],
      );
      expect(rows[0]?.access_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]?.access_token_hash).not.toContain(courier.accessToken);
      // A listagem do painel nunca devolve o token.
      expect(JSON.stringify((await panel('GET', '/couriers')).json())).not.toContain(courier.accessToken);
    });

    it('link inválido, de entregador desligado ou trocado não entra', async () => {
      const courier = await createCourier();
      const garbage = [null, 'curto', 'x'.repeat(43), `${courier.accessToken.slice(0, 42)}!`];
      for (const token of garbage) {
        const res = await asCourier(token, 'GET', '/deliveries');
        expect(res.statusCode, String(token)).toBe(401);
        expect(res.json()).toMatchObject({ error: 'courier_link_invalid' });
      }

      const rotated = (await panel('POST', `/couriers/${courier.id}/access-token`)).json<CourierAccessView>();
      expect(rotated.accessToken).not.toBe(courier.accessToken);
      expect((await asCourier(courier.accessToken, 'GET', '/deliveries')).statusCode).toBe(401);
      expect((await asCourier(rotated.accessToken, 'GET', '/deliveries')).statusCode).toBe(200);

      expect((await panel('PATCH', `/couriers/${courier.id}`, { active: false })).statusCode).toBe(204);
      expect((await asCourier(rotated.accessToken, 'GET', '/deliveries')).statusCode).toBe(401);
      await panel('PATCH', `/couriers/${courier.id}`, { active: true });
      expect((await asCourier(rotated.accessToken, 'GET', '/deliveries')).statusCode).toBe(200);
    });

    it('valida os dados, recusa telefone repetido e não mexe em entregador de outra loja', async () => {
      const taken = phone();
      expect((await panel('POST', '/couriers', { name: 'Um', phone: taken })).statusCode).toBe(201);
      const repeated = await panel('POST', '/couriers', { name: 'Dois', phone: taken });
      expect(repeated.statusCode).toBe(409);
      expect(repeated.json()).toMatchObject({ error: 'courier_phone_taken' });
      // Em outra loja o mesmo telefone é livre: o entregador pode trabalhar para as duas.
      expect((await panel('POST', '/couriers', { name: 'Um', phone: taken }, other)).statusCode).toBe(201);

      for (const body of [{ name: '', phone: phone() }, { name: 'Sem DDD', phone: '99999-0000' }, { phone: phone() }]) {
        expect((await panel('POST', '/couriers', body)).statusCode, JSON.stringify(body)).toBe(400);
      }

      const mine = await createCourier();
      expect((await panel('PATCH', `/couriers/${mine.id}`, { name: 'Invasor' }, other)).statusCode).toBe(404);
      expect((await panel('POST', `/couriers/${mine.id}/access-token`, undefined, other)).statusCode).toBe(404);
      expect((await panel('PATCH', `/couriers/${newId()}`, { name: 'Fantasma' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/v1/panel/stores/${store.slug}/couriers` })).statusCode).toBe(
        401,
      );
    });
  });

  describe('atribuição do pedido', () => {
    it('o pedido atribuído aparece para o entregador com o que ele precisa para entregar', async () => {
      const courier = await createCourier('Marcos Vinícius');
      const order = await placeOrder({ notes: 'portão azul' });

      const assigned = await assign(order.id, courier.id);
      expect(assigned.statusCode).toBe(200);
      expect(assigned.json<PanelOrderView>().courier).toEqual({ id: courier.id, name: 'Marcos Vinícius' });
      const open = (await panel('GET', '/orders')).json<PanelOrderView[]>();
      expect(open.find((item) => item.id === order.id)?.courier?.name).toBe('Marcos Vinícius');

      const home = await deliveries(courier.accessToken);
      expect(home.deliveries).toEqual([
        {
          orderId: order.id,
          number: order.number,
          status: 'pending',
          customer: { name: 'Carla Dias', phone: expect.stringMatching(/^\+5511/) },
          address: ADDRESS,
          notes: 'portão azul',
          paymentMethod: 'cash',
          totalCents: 2000,
          itemsSummary: '2 x Refrigerante lata',
        },
      ]);
    });

    it('trocar ou retirar o entregador muda quem vê a entrega, e repetir não gera evento em dobro', async () => {
      const first = await createCourier('Primeiro');
      const second = await createCourier('Segundo');
      const order = await placeOrder();

      await assign(order.id, first.id);
      await assign(order.id, first.id);
      await assign(order.id, second.id);
      expect((await deliveries(first.accessToken)).deliveries).toEqual([]);
      expect((await deliveries(second.accessToken)).deliveries.map((item) => item.orderId)).toEqual([order.id]);

      const cleared = await assign(order.id, null);
      expect(cleared.json<PanelOrderView>().courier).toBeNull();
      expect((await deliveries(second.accessToken)).deliveries).toEqual([]);

      const events = await app.get(TenantDb).withTenant(store.tenantId, (tx) =>
        tx.query<{ to: string | null }>(
          `SELECT payload->>'to' AS to FROM order_events
              WHERE order_id = $1 AND type = 'order.courier_assigned' ORDER BY created_at, id`,
          [order.id],
        ),
      );
      expect(events.rows.map((row) => row.to)).toEqual([first.id, second.id, null]);
    });

    it('recusa atribuição que não faz sentido', async () => {
      const courier = await createCourier();
      const foreign = await createCourier('De outra loja', other);
      const delivery = await placeOrder();

      const pickup = await placeOrder({ fulfillment: 'pickup', deliveryAddress: undefined });
      expect((await assign(pickup.id, courier.id)).json()).toMatchObject({ error: 'not_a_delivery' });

      expect((await assign(delivery.id, newId())).statusCode).toBe(404);
      // Entregador de outra loja não existe para esta.
      const crossed = await assign(delivery.id, foreign.id);
      expect(crossed.statusCode).toBe(404);
      expect(crossed.json()).toMatchObject({ error: 'courier_not_found' });

      await panel('PATCH', `/couriers/${courier.id}`, { active: false });
      const inactive = await assign(delivery.id, courier.id);
      expect(inactive.statusCode).toBe(409);
      expect(inactive.json()).toMatchObject({ error: 'courier_inactive' });
      await panel('PATCH', `/couriers/${courier.id}`, { active: true });

      await setStatus(delivery.id, 'cancelled');
      expect((await assign(delivery.id, courier.id)).json()).toMatchObject({ error: 'order_closed' });

      const fresh = await placeOrder();
      expect((await assign(fresh.id, courier.id, other)).statusCode).toBe(404);
      expect((await assign('nao-e-id', courier.id)).statusCode).toBe(404);
      expect((await panel('POST', `/orders/${fresh.id}/courier`, { courierId: 'x' })).statusCode).toBe(400);
    });
  });

  describe('o entregador opera a entrega', () => {
    it('marca que saiu e que entregou; o pagamento em dinheiro fica como recebido', async () => {
      const courier = await createCourier();
      const order = await placeOrder();
      await assign(order.id, courier.id);

      // Pedido que a cozinha ainda não aprontou não pode sair.
      const early = await asCourier(courier.accessToken, 'POST', `/deliveries/${order.id}/status`, {
        status: 'out_for_delivery',
      });
      expect(early.statusCode).toBe(409);

      await setStatus(order.id, 'confirmed', 'preparing', 'ready');
      for (const status of ['out_for_delivery', 'completed']) {
        const res = await asCourier(courier.accessToken, 'POST', `/deliveries/${order.id}/status`, { status });
        expect(res.statusCode, status).toBe(204);
      }
      expect((await track(order.id)).status).toBe('completed');
      expect((await deliveries(courier.accessToken)).deliveries).toEqual([]);

      const rows = await app.get(TenantDb).withTenant(store.tenantId, async (tx) => ({
        payment: (await tx.query('SELECT status FROM payments WHERE order_id = $1', [order.id])).rows[0],
        actor: (
          await tx.query(
            `SELECT payload->>'courierId' AS courier FROM order_events
              WHERE order_id = $1 AND payload->>'to' = 'completed'`,
            [order.id],
          )
        ).rows[0],
      }));
      // O histórico registra que foi o entregador quem concluiu.
      expect(rows).toEqual({ payment: { status: 'paid' }, actor: { courier: courier.id } });
    });

    it('não mexe em pedido de outro entregador, sem entregador ou de outra loja', async () => {
      const mine = await createCourier('Meu');
      const colleague = await createCourier('Colega');
      const foreign = await createCourier('Estranho', other);

      const order = await placeOrder();
      await assign(order.id, colleague.id);
      await setStatus(order.id, 'confirmed', 'preparing', 'ready');
      const unassigned = await placeOrder();
      await setStatus(unassigned.id, 'confirmed', 'preparing', 'ready');

      for (const [token, orderId] of [
        [mine.accessToken, order.id],
        [mine.accessToken, unassigned.id],
        [foreign.accessToken, order.id],
        [mine.accessToken, newId()],
      ] as const) {
        const res = await asCourier(token, 'POST', `/deliveries/${orderId}/status`, { status: 'out_for_delivery' });
        expect(res.statusCode).toBe(404);
      }
      expect((await track(order.id)).status).toBe('ready');

      // O entregador só faz as duas mudanças dele.
      for (const status of ['cancelled', 'confirmed', 'ready']) {
        const res = await asCourier(colleague.accessToken, 'POST', `/deliveries/${order.id}/status`, { status });
        expect(res.statusCode, status).toBe(400);
      }
    });
  });

  describe('localização', () => {
    const POSITION = { lat: -22.9056, lng: -47.0608, accuracy: 12 };

    it('o cliente vê o primeiro nome do entregador e a posição só enquanto o pedido está a caminho', async () => {
      const courier = await createCourier('Rafael Souza Lima');
      const order = await placeOrder();
      expect((await track(order.id)).courier).toBeNull();

      await assign(order.id, courier.id);
      expect((await asCourier(courier.accessToken, 'POST', '/position', POSITION)).statusCode).toBe(204);
      await setStatus(order.id, 'confirmed', 'preparing', 'ready');
      // Antes de sair: só o nome.
      expect((await track(order.id)).courier).toEqual({ name: 'Rafael', position: null });

      await asCourier(courier.accessToken, 'POST', `/deliveries/${order.id}/status`, { status: 'out_for_delivery' });
      const onTheWay = (await track(order.id)).courier;
      expect(onTheWay).toMatchObject({ name: 'Rafael', position: { lat: -22.9056, lng: -47.0608, accuracy: 12 } });
      expect(Date.now() - Date.parse(onTheWay?.position?.recordedAt ?? '')).toBeLessThan(5_000);

      // A visão pública não entrega telefone nem sobrenome do entregador.
      const raw = await app.inject({ method: 'GET', url: `/v1/stores/${store.slug}/orders/${order.id}` });
      expect(raw.body).not.toContain('Souza');
      expect(raw.body).not.toContain('phone');

      await asCourier(courier.accessToken, 'POST', `/deliveries/${order.id}/status`, { status: 'completed' });
      expect((await track(order.id)).courier).toBeNull();
    });

    it('guarda só a última posição, com prazo de validade, e apaga ao desligar o entregador', async () => {
      const courier = await createCourier();
      const redis = app.get<Redis>(REDIS_CACHE);
      const key = `courier-pos:${store.tenantId}:${courier.id}`;

      await asCourier(courier.accessToken, 'POST', '/position', POSITION);
      await asCourier(courier.accessToken, 'POST', '/position', { lat: -22.9, lng: -47.05 });
      expect(JSON.parse((await redis.get(key)) as string)).toMatchObject({ lat: -22.9, lng: -47.05, accuracy: null });
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);

      await panel('PATCH', `/couriers/${courier.id}`, { active: false });
      expect(await redis.get(key)).toBeNull();
    });

    it('recusa posição inválida ou sem link válido', async () => {
      const courier = await createCourier();
      for (const body of [{ lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: 'norte', lng: 0 }, { lng: 10 }, {}]) {
        const res = await asCourier(courier.accessToken, 'POST', '/position', body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect((await asCourier(null, 'POST', '/position', POSITION)).statusCode).toBe(401);
    });
  });
});
