import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OrderView, PanelOrderView, RealtimeMessage } from '@onefood/shared';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerModule } from '../src/app.modules.js';
import { EventsWorker, OutboxRelay } from '../src/modules/outbox/index.js';
import { realtimeChannel, verifyRealtimeToken } from '../src/modules/realtime/index.js';
import { TenantDb } from '../src/platform/db/tenant-db.js';
import { newId } from '../src/platform/ids.js';
import { REDIS_CACHE } from '../src/platform/tokens.js';
import { createApiApp, orderBody, type PanelStore, signupStore, waitFor } from './helpers.js';

const ADDRESS = {
  street: 'Rua das Flores',
  number: '120',
  district: 'Centro',
  city: 'Campinas',
  state: 'SP',
  postalCode: '13010000',
};

describe('painel de pedidos', () => {
  let app: NestFastifyApplication;
  let store: PanelStore;
  let other: PanelStore;

  beforeAll(async () => {
    app = await createApiApp();
    store = await signupStore(app);
    other = await signupStore(app);
  });
  afterAll(() => app.close());

  const place = async (overrides: Record<string, unknown> = {}, target: PanelStore = store): Promise<OrderView> => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${target.slug}/orders`,
      headers: { 'idempotency-key': newId() },
      payload: orderBody(target, overrides),
    });
    expect(res.statusCode).toBe(201);
    return res.json<OrderView>();
  };
  const list = async (scope?: string, as: PanelStore = store) =>
    app.inject({
      method: 'GET',
      url: `/v1/panel/stores/${store.slug}/orders${scope ? `?scope=${scope}` : ''}`,
      headers: { cookie: as.cookie },
    });
  const setStatus = (orderId: string, status: string, as: PanelStore | null = store) =>
    app.inject({
      method: 'POST',
      url: `/v1/panel/stores/${store.slug}/orders/${orderId}/status`,
      payload: { status },
      headers: as ? { cookie: as.cookie } : {},
    });
  const dbRows = <T>(sql: string, values: unknown[]) =>
    app.get(TenantDb).withTenant(store.tenantId, async (tx) => (await tx.query(sql, values)).rows as T[]);

  it('lista os pedidos em aberto, do mais antigo ao mais novo, com cliente e endereço', async () => {
    const first = await place({ customer: { name: 'Bia', phone: '+5511911110001' } });
    const second = await place({ fulfillment: 'delivery', deliveryAddress: ADDRESS, notes: 'tocar o interfone' });

    const res = await list();
    expect(res.statusCode).toBe(200);
    const orders = res.json<PanelOrderView[]>();
    expect(orders.map((order) => order.id)).toEqual([first.id, second.id]);
    expect(orders[0]).toMatchObject({ customer: { name: 'Bia', phone: '+5511911110001' }, deliveryAddress: null });
    expect(orders[1]).toMatchObject({ deliveryAddress: ADDRESS, notes: 'tocar o interfone', totalCents: 2000 });
    expect(orders[1]?.items).toHaveLength(1);
  });

  it('leva um pedido de retirada do recebimento à conclusão e registra cada passo', async () => {
    const order = await place({ paymentMethod: 'cash' });
    for (const status of ['confirmed', 'preparing', 'ready', 'completed']) {
      const res = await setStatus(order.id, status);
      expect(res.statusCode, status).toBe(200);
      expect(res.json<PanelOrderView>().status).toBe(status);
    }

    const events = await dbRows<{ type: string; to: string | null }>(
      "SELECT type, payload->>'to' AS to FROM order_events WHERE order_id = $1 ORDER BY created_at, id",
      [order.id],
    );
    expect(events.map((event) => event.to ?? event.type)).toEqual([
      'order.created',
      'confirmed',
      'preparing',
      'ready',
      'completed',
    ]);
    // Dinheiro é recebido na conclusão.
    const payments = await dbRows<{ status: string; paid: boolean }>(
      'SELECT status, paid_at IS NOT NULL AS paid FROM payments WHERE order_id = $1',
      [order.id],
    );
    expect(payments).toEqual([{ status: 'paid', paid: true }]);

    const open = (await list()).json<PanelOrderView[]>();
    expect(open.map((o) => o.id)).not.toContain(order.id);
    const recent = (await list('recent')).json<PanelOrderView[]>();
    expect(recent[0]?.id).toBe(order.id);
  });

  it('pedido de entrega passa por "saiu para entrega" antes de concluir', async () => {
    const order = await place({ fulfillment: 'delivery', deliveryAddress: ADDRESS });
    for (const status of ['confirmed', 'preparing', 'ready']) await setStatus(order.id, status);

    const skipped = await setStatus(order.id, 'completed');
    expect(skipped.statusCode).toBe(409);
    expect(skipped.json()).toEqual({
      error: 'invalid_transition',
      from: 'ready',
      to: 'completed',
      allowed: ['out_for_delivery', 'cancelled'],
    });
    expect((await setStatus(order.id, 'out_for_delivery')).statusCode).toBe(200);
    expect((await setStatus(order.id, 'completed')).statusCode).toBe(200);

    // Pix não vira "pago" só porque o pedido foi concluído: depende do aviso do provedor.
    const payments = await dbRows<{ status: string }>('SELECT status FROM payments WHERE order_id = $1', [order.id]);
    expect(payments).toEqual([{ status: 'pending' }]);
  });

  it('recusa pular etapas, voltar atrás e mexer em pedido encerrado', async () => {
    const order = await place();
    expect((await setStatus(order.id, 'ready')).statusCode).toBe(409);
    await setStatus(order.id, 'confirmed');
    expect((await setStatus(order.id, 'pending')).statusCode).toBe(409);
    expect((await setStatus(order.id, 'inventado')).statusCode).toBe(400);

    await setStatus(order.id, 'cancelled');
    const reopened = await setStatus(order.id, 'confirmed');
    expect(reopened.statusCode).toBe(409);
    expect(reopened.json()).toMatchObject({ from: 'cancelled', allowed: [] });
  });

  it('cancelar o pedido cancela o pagamento pendente', async () => {
    const order = await place();
    expect((await setStatus(order.id, 'cancelled')).statusCode).toBe(200);
    const payments = await dbRows<{ status: string }>('SELECT status FROM payments WHERE order_id = $1', [order.id]);
    expect(payments).toEqual([{ status: 'cancelled' }]);
  });

  it('repetir o mesmo estado não gera evento em dobro', async () => {
    const order = await place();
    const [first, second] = await Promise.all([setStatus(order.id, 'confirmed'), setStatus(order.id, 'confirmed')]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    const events = await dbRows("SELECT 1 FROM order_events WHERE order_id = $1 AND type = 'order.status_changed'", [
      order.id,
    ]);
    expect(events).toHaveLength(1);
  });

  it('o cliente acompanha o estado pelo endereço público do pedido', async () => {
    const order = await place();
    await setStatus(order.id, 'confirmed');
    const tracked = await app.inject({ method: 'GET', url: `/v1/stores/${store.slug}/orders/${order.id}` });
    expect(tracked.json<OrderView>().status).toBe('confirmed');
    // A visão pública não expõe os dados do cliente.
    expect(tracked.json()).not.toHaveProperty('customer');
    expect(tracked.json()).not.toHaveProperty('deliveryAddress');
  });

  it('exige sessão e vínculo; pedido de outro restaurante não existe para este', async () => {
    const order = await place();
    expect((await setStatus(order.id, 'confirmed', null)).statusCode).toBe(401);
    expect((await setStatus(order.id, 'confirmed', other)).statusCode).toBe(404);
    expect((await list(undefined, other)).statusCode).toBe(404);

    const foreign = await place({}, other);
    const res = await setStatus(foreign.id, 'confirmed');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'order_not_found' });
    expect((await setStatus('nao-e-um-id', 'confirmed')).statusCode).toBe(404);
    expect((await list('tudo')).statusCode).toBe(400);
  });

  it('registra a primeira impressão do pedido, uma vez só', async () => {
    const order = await place();
    const find = async () => (await list()).json<PanelOrderView[]>().find((item) => item.id === order.id);
    expect((await find())?.printedAt).toBeNull();

    const mark = (as: PanelStore | null = store, id = order.id) =>
      app.inject({
        method: 'POST',
        url: `/v1/panel/stores/${store.slug}/orders/${id}/printed`,
        headers: as ? { cookie: as.cookie } : {},
      });
    expect((await mark()).statusCode).toBe(204);
    const first = (await find())?.printedAt;
    expect(Date.now() - Date.parse(first ?? '')).toBeLessThan(5_000);

    // Reimprimir não muda o horário nem repete o evento.
    expect((await mark()).statusCode).toBe(204);
    expect((await find())?.printedAt).toBe(first);
    const events = await dbRows("SELECT 1 FROM order_events WHERE order_id = $1 AND type = 'order.printed'", [
      order.id,
    ]);
    expect(events).toHaveLength(1);

    expect((await mark(null)).statusCode).toBe(401);
    expect((await mark(other)).statusCode).toBe(404);
    expect((await mark(store, newId())).statusCode).toBe(404);
    expect((await mark(store, 'nao-e-id')).statusCode).toBe(404);
  });

  it('entrega ao painel um token de tempo real válido só para o próprio restaurante', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/panel/stores/${store.slug}/realtime-token`,
      headers: { cookie: store.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { token, url } = res.json<{ token: string; url: string }>();
    expect(url).toBe('ws://localhost:3001/ws');
    expect(verifyRealtimeToken(process.env.REALTIME_TOKEN_SECRET as string, token)).toBe(store.tenantId);

    const denied = await app.inject({
      method: 'POST',
      url: `/v1/panel/stores/${store.slug}/realtime-token`,
      headers: { cookie: other.cookie },
    });
    expect(denied.statusCode).toBe(404);
  });

  describe('com os workers no ar', () => {
    let workers: INestApplicationContext;
    beforeAll(async () => {
      workers = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
      workers.get(EventsWorker).start();
      workers.get(OutboxRelay).start({ idleDelayMs: 20 });
    });
    afterAll(() => workers.close());

    it('a mudança de estado chega aos painéis do restaurante', async () => {
      const subscriber = workers.get<Redis>(REDIS_CACHE).duplicate();
      const messages: RealtimeMessage[] = [];
      subscriber.on('message', (_channel, raw) => messages.push(JSON.parse(raw) as RealtimeMessage));
      await subscriber.subscribe(realtimeChannel(store.tenantId));
      try {
        const order = await place();
        await setStatus(order.id, 'confirmed');
        const change = await waitFor(async () =>
          messages.find((message) => message.type === 'order.status_changed' && message.data.orderId === order.id),
        );
        expect(change.data).toEqual({ orderId: order.id, number: order.number, from: 'pending', to: 'confirmed' });
      } finally {
        await subscriber.quit();
      }
    });
  });
});
