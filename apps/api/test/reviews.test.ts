import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OrderView, RealtimeMessage, ReviewsSummaryView, TrackedOrderView } from '@onefood/shared';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerModule } from '../src/app.modules.js';
import { EventsWorker, OutboxRelay } from '../src/modules/outbox/index.js';
import { realtimeChannel } from '../src/modules/realtime/index.js';
import { newId } from '../src/platform/ids.js';
import { REDIS_CACHE } from '../src/platform/tokens.js';
import { createApiApp, orderBody, type PanelStore, signupStore, waitFor } from './helpers.js';

describe('avaliação pós-pedido', () => {
  let app: NestFastifyApplication;
  let store: PanelStore;
  let other: PanelStore;

  beforeAll(async () => {
    app = await createApiApp();
    store = await signupStore(app);
    other = await signupStore(app);
  });
  afterAll(() => app.close());

  /** Cria um pedido de retirada e, se pedido, leva até a conclusão. */
  const placeOrder = async (complete = true, target: PanelStore = store, name = 'Nina'): Promise<OrderView> => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${target.slug}/orders`,
      headers: { 'idempotency-key': newId() },
      payload: orderBody(target, {
        // Cliente é identificado pelo telefone: cada pedido de teste usa um número próprio.
        customer: { name, phone: `+55119${String(Math.floor(Math.random() * 90000000) + 10000000)}` },
        items: [
          { productId: target.menu.refrigerante, quantity: 1 },
          { productId: target.menu.calabresa, quantity: 1, optionIds: [target.menu.calabresaGrande] },
        ],
      }),
    });
    const order = res.json<OrderView>();
    if (complete) {
      for (const status of ['confirmed', 'preparing', 'ready', 'completed']) {
        await app.inject({
          method: 'POST',
          url: `/v1/panel/stores/${target.slug}/orders/${order.id}/status`,
          payload: { status },
          headers: { cookie: target.cookie },
        });
      }
    }
    return order;
  };
  const review = (order: OrderView, body: unknown, slug = store.slug) =>
    app.inject({ method: 'POST', url: `/v1/stores/${slug}/orders/${order.id}/review`, payload: body as object });
  const summary = async (as: PanelStore = store) =>
    (
      await app.inject({ method: 'GET', url: `/v1/panel/stores/${as.slug}/reviews`, headers: { cookie: as.cookie } })
    ).json<ReviewsSummaryView>();

  it('o cliente avalia o pedido concluído, com nota por prato, e vê a avaliação no acompanhamento', async () => {
    const order = await placeOrder();
    const res = await review(order, {
      rating: 4,
      comment: '  Chegou quentinho.  ',
      items: [
        { lineNo: 1, rating: 5 },
        { lineNo: 2, rating: 3 },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      rating: 4,
      comment: 'Chegou quentinho.',
      items: [
        { lineNo: 1, productId: store.menu.refrigerante, productName: 'Refrigerante lata', rating: 5 },
        { lineNo: 2, productId: store.menu.calabresa, productName: 'Pizza Calabresa', rating: 3 },
      ],
    });

    const tracked = await app.inject({ method: 'GET', url: `/v1/stores/${store.slug}/orders/${order.id}` });
    expect(tracked.json<TrackedOrderView>().review).toMatchObject({ rating: 4, comment: 'Chegou quentinho.' });
  });

  it('só vale para pedido concluído, uma vez só', async () => {
    const open = await placeOrder(false);
    const early = await review(open, { rating: 5 });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ error: 'review_not_available' });

    const done = await placeOrder();
    expect((await review(done, { rating: 5 })).statusCode).toBe(201);
    const twice = await review(done, { rating: 1, comment: 'mudei de ideia' });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ error: 'already_reviewed' });
    const tracked = await app.inject({ method: 'GET', url: `/v1/stores/${store.slug}/orders/${done.id}` });
    expect(tracked.json<TrackedOrderView>().review?.rating).toBe(5);
  });

  it('valida a nota e os itens', async () => {
    const order = await placeOrder();
    const invalid: Array<[unknown, number]> = [
      [{ rating: 0 }, 400],
      [{ rating: 6 }, 400],
      [{ rating: 4.5 }, 400],
      [{}, 400],
      [{ rating: 5, comment: 'x'.repeat(1001) }, 400],
      [{ rating: 5, items: [{ lineNo: 1, rating: 9 }] }, 400],
      [
        {
          rating: 5,
          items: [
            { lineNo: 1, rating: 5 },
            { lineNo: 1, rating: 4 },
          ],
        },
        400,
      ],
      // Linha que não existe no pedido.
      [{ rating: 5, items: [{ lineNo: 7, rating: 5 }] }, 422],
    ];
    for (const [body, status] of invalid) {
      expect((await review(order, body)).statusCode, JSON.stringify(body)).toBe(status);
    }
    // Nada do que foi recusado ficou gravado.
    expect((await review(order, { rating: 5 })).statusCode).toBe(201);
  });

  it('pedido de outra loja ou inexistente não pode ser avaliado', async () => {
    const order = await placeOrder();
    expect((await review(order, { rating: 5 }, other.slug)).statusCode).toBe(404);
    const fake = { ...order, id: newId() };
    expect((await review(fake, { rating: 5 })).statusCode).toBe(404);
    expect((await review({ ...order, id: 'nao-e-id' }, { rating: 5 })).statusCode).toBe(404);
  });

  it('o painel mostra média geral, média por prato e as avaliações recentes', async () => {
    const fresh = await signupStore(app);
    expect(await summary(fresh)).toEqual({ count: 0, average: null, lowCount: 0, products: [], reviews: [] });

    const first = await placeOrder(true, fresh, 'Ana');
    const second = await placeOrder(true, fresh, 'Beto');
    await review(
      first,
      {
        rating: 5,
        items: [
          { lineNo: 1, rating: 5 },
          { lineNo: 2, rating: 4 },
        ],
      },
      fresh.slug,
    );
    await review(second, { rating: 2, comment: 'Demorou.', items: [{ lineNo: 2, rating: 1 }] }, fresh.slug);

    const result = await summary(fresh);
    expect(result).toMatchObject({ count: 2, average: 3.5, lowCount: 1 });
    // Pior prato primeiro: é o que pede atenção.
    expect(result.products).toEqual([
      { productId: fresh.menu.calabresa, productName: 'Pizza Calabresa', average: 2.5, count: 2 },
      { productId: fresh.menu.refrigerante, productName: 'Refrigerante lata', average: 5, count: 1 },
    ]);
    expect(result.reviews.map((item) => [item.orderNumber, item.customerName, item.rating, item.comment])).toEqual([
      [second.number, 'Beto', 2, 'Demorou.'],
      [first.number, 'Ana', 5, null],
    ]);

    const url = `/v1/panel/stores/${fresh.slug}/reviews`;
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url, headers: { cookie: other.cookie } })).statusCode).toBe(404);
  });

  describe('com os workers no ar', () => {
    let workers: INestApplicationContext;
    beforeAll(async () => {
      workers = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
      workers.get(EventsWorker).start();
      workers.get(OutboxRelay).start({ idleDelayMs: 20 });
    });
    afterAll(() => workers.close());

    it('nota baixa chega ao painel na hora, marcada como baixa', async () => {
      const subscriber = workers.get<Redis>(REDIS_CACHE).duplicate();
      const messages: RealtimeMessage[] = [];
      subscriber.on('message', (_channel, raw) => messages.push(JSON.parse(raw) as RealtimeMessage));
      await subscriber.subscribe(realtimeChannel(store.tenantId));
      try {
        const bad = await placeOrder();
        const good = await placeOrder();
        await review(bad, { rating: 2 });
        await review(good, { rating: 3 });

        // A fila também entrega avaliações de testes anteriores; espera pelas duas deste teste.
        const find = (orderId: string) =>
          messages.find((message) => message.type === 'review.created' && message.data.orderId === orderId);
        await waitFor(async () => find(bad.id) && find(good.id));
        expect(find(bad.id)?.data).toEqual({ orderId: bad.id, number: bad.number, rating: 2, low: true });
        expect(find(good.id)?.data).toEqual({ orderId: good.id, number: good.number, rating: 3, low: false });
      } finally {
        await subscriber.quit();
      }
    });
  });
});
