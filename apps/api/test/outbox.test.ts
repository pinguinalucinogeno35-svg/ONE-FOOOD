import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OrderView, RealtimeMessage } from '@onefood/shared';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerModule } from '../src/app.modules.js';
import { EVENTS_QUEUE, EventConsumers, EventsWorker, OutboxRelay } from '../src/modules/outbox/index.js';
import { realtimeChannel } from '../src/modules/realtime/index.js';
import { newId } from '../src/platform/ids.js';
import { REDIS_CACHE, REDIS_QUEUE, RELAY_POOL } from '../src/platform/tokens.js';
import { createApiApp, createStore, orderBody, type TestStore, waitFor } from './helpers.js';

interface OutboxRow {
  id: string;
  published_at: Date | null;
  processed_at: Date | null;
  attempts: number;
}

describe('outbox: do pedido gravado até o painel', () => {
  let api: NestFastifyApplication;
  let workers: INestApplicationContext;
  let relay: OutboxRelay;
  let relayPool: Pool;
  let store: TestStore;
  const seen: string[] = [];
  let failuresLeft = 0;

  beforeAll(async () => {
    api = await createApiApp();
    workers = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    relay = workers.get(OutboxRelay);
    relayPool = workers.get<Pool>(RELAY_POOL);
    store = await createStore(api);

    workers.get(EventConsumers).on('order.created', 'teste', async (event) => {
      if (event.tenantId !== store.tenantId) return;
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('consumidor fora do ar');
      }
      seen.push(event.payload.orderId);
    });
  });
  afterAll(async () => {
    await workers.close();
    await api.close();
  });

  const placeOrder = async (): Promise<OrderView> => {
    const res = await api.inject({
      method: 'POST',
      url: `/v1/stores/${store.slug}/orders`,
      headers: { 'idempotency-key': newId() },
      payload: orderBody(store),
    });
    expect(res.statusCode).toBe(201);
    return res.json<OrderView>();
  };
  const outboxRow = async (orderId: string): Promise<OutboxRow> => {
    const { rows } = await relayPool.query<OutboxRow>(
      "SELECT id, published_at, processed_at, attempts FROM outbox WHERE tenant_id = $1 AND payload->>'orderId' = $2",
      [store.tenantId, orderId],
    );
    if (!rows[0]) throw new Error('evento não encontrado no outbox');
    return rows[0];
  };
  const drain = async (): Promise<void> => {
    while ((await relay.publishPending()) > 0);
  };

  it('o evento fica pendente no banco até o relay publicar', async () => {
    const order = await placeOrder();
    expect(await outboxRow(order.id)).toMatchObject({ published_at: null, processed_at: null, attempts: 0 });

    await drain();
    const published = await outboxRow(order.id);
    expect(published.published_at).not.toBeNull();
    expect(published.attempts).toBe(1);
    expect(await relay.publishPending()).toBe(0);
  });

  it('o worker entrega aos consumidores, avisa o painel e registra a conclusão', async () => {
    const subscriber = workers.get<Redis>(REDIS_CACHE).duplicate();
    const messages: RealtimeMessage[] = [];
    subscriber.on('message', (_channel, raw) => messages.push(JSON.parse(raw) as RealtimeMessage));
    await subscriber.subscribe(realtimeChannel(store.tenantId));

    try {
      const order = await placeOrder();
      await drain();
      workers.get(EventsWorker).start();

      await waitFor(async () => (await outboxRow(order.id)).processed_at);
      expect(seen).toContain(order.id);
      const message = await waitFor(async () => messages.find((m) => m.data.orderId === order.id));
      expect(message).toEqual({
        type: 'order.created',
        data: {
          orderId: order.id,
          number: order.number,
          totalCents: 1400,
          fulfillment: 'pickup',
          paymentMethod: 'pix',
        },
      });
    } finally {
      await subscriber.quit();
    }
  });

  it('repete a entrega quando um consumidor falha', async () => {
    failuresLeft = 1;
    const order = await placeOrder();
    await drain();
    await waitFor(async () => (await outboxRow(order.id)).processed_at, 15_000);
    expect(failuresLeft).toBe(0);
    expect(seen.filter((id) => id === order.id)).toHaveLength(1);
  });

  it('a reconciliação recupera um evento que o Redis perdeu', async () => {
    const order = await placeOrder();
    const row = await outboxRow(order.id);

    // Publica e apaga a tarefa da fila antes de alguém processar: simula o failover do Redis.
    const queue = new Queue(EVENTS_QUEUE, { connection: workers.get<Redis>(REDIS_QUEUE) });
    await queue.pause();
    try {
      await drain();
      await queue.remove(`outbox-${row.id}-0`);
    } finally {
      await queue.resume();
      await queue.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await outboxRow(order.id)).processed_at).toBeNull();
    expect(seen).not.toContain(order.id);

    const { requeued } = await relay.reconcile(0);
    expect(requeued).toBeGreaterThanOrEqual(1);
    expect((await outboxRow(order.id)).published_at).toBeNull();

    await drain();
    await waitFor(async () => (await outboxRow(order.id)).processed_at);
    expect(seen).toContain(order.id);
    expect((await outboxRow(order.id)).attempts).toBe(2);
  });

  it('não reenfileira o que já foi concluído', async () => {
    const order = await placeOrder();
    await drain();
    await waitFor(async () => (await outboxRow(order.id)).processed_at);
    await relay.reconcile(0);
    const row = await outboxRow(order.id);
    expect(row.published_at).not.toBeNull();
    expect(row.attempts).toBe(1);
  });
});
