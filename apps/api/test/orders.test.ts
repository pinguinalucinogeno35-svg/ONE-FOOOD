import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OrderView } from '@onefood/shared';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantDb } from '../src/platform/db/tenant-db.js';
import { newId } from '../src/platform/ids.js';
import { RELAY_POOL } from '../src/platform/tokens.js';
import { createApiApp, createStore, orderBody, type TestStore } from './helpers.js';

describe('pedidos', () => {
  let app: NestFastifyApplication;
  let store: TestStore;

  beforeAll(async () => {
    app = await createApiApp();
    store = await createStore(app);
  });
  afterAll(() => app.close());

  const post = (body: unknown, key: string | null = newId(), slug = store.slug) =>
    app.inject({
      method: 'POST',
      url: `/v1/stores/${slug}/orders`,
      headers: key ? { 'idempotency-key': key } : {},
      payload: body as object,
    });

  it('cria o pedido com os valores calculados no servidor', async () => {
    const res = await post(
      orderBody(store, {
        fulfillment: 'delivery',
        deliveryAddress: {
          street: 'Rua das Flores',
          number: '120',
          district: 'Centro',
          city: 'Campinas',
          state: 'SP',
          postalCode: '13010000',
        },
        items: [
          {
            productId: store.menu.margherita,
            quantity: 2,
            optionIds: [store.menu.tamanhoGrande, store.menu.bordaRecheada],
            notes: 'sem cebola',
          },
          { productId: store.menu.refrigerante, quantity: 3 },
        ],
      }),
    );
    expect(res.statusCode).toBe(201);
    const order = res.json<OrderView>();

    // Margherita 45,00 + Grande 12,00 + borda 8,00 = 65,00; x2 = 130,00. Refrigerante 7,00 x3 = 21,00.
    expect(order.items.map((item) => [item.lineNo, item.unitPriceCents, item.totalCents])).toEqual([
      [1, 6500, 13000],
      [2, 700, 2100],
    ]);
    expect(order.subtotalCents).toBe(15100);
    expect(order.deliveryFeeCents).toBe(600);
    expect(order.totalCents).toBe(15700);
    expect(order.status).toBe('pending');
    expect(order.items[0]?.options.map((option) => option.name)).toEqual(['Grande', 'Borda recheada']);

    const fetched = await app.inject({ method: 'GET', url: `/v1/stores/${store.slug}/orders/${order.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual({ ...order, review: null, courier: null });
  });

  it('grava pedido, evento, pagamento pendente e outbox na mesma transação', async () => {
    const res = await post(orderBody(store));
    const order = res.json<OrderView>();

    const rows = await app.get(TenantDb).withTenant(store.tenantId, async (tx) => ({
      events: (await tx.query('SELECT type FROM order_events WHERE order_id = $1', [order.id])).rows,
      payments: (await tx.query('SELECT method, status, amount_cents FROM payments WHERE order_id = $1', [order.id]))
        .rows,
    }));
    expect(rows.events).toEqual([{ type: 'order.created' }]);
    expect(rows.payments).toEqual([{ method: 'pix', status: 'pending', amount_cents: 1400 }]);

    const outbox = await app
      .get<Pool>(RELAY_POOL)
      .query("SELECT topic FROM outbox WHERE tenant_id = $1 AND payload->>'orderId' = $2", [store.tenantId, order.id]);
    expect(outbox.rows).toEqual([{ topic: 'order.created' }]);
  });

  it('numera os pedidos em sequência por loja', async () => {
    const other = await createStore(app);
    const first = (await post(orderBody(other), newId(), other.slug)).json<OrderView>();
    const second = (await post(orderBody(other), newId(), other.slug)).json<OrderView>();
    expect([first.number, second.number]).toEqual([1, 2]);
  });

  describe('idempotência', () => {
    it('a mesma chave devolve o mesmo pedido e não cria outro', async () => {
      const key = newId();
      const first = await post(orderBody(store), key);
      const second = await post(orderBody(store), key);
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());

      const count = await app.get(TenantDb).withTenant(store.tenantId, (tx) =>
        tx.query<{ orders: string; payments: string }>(
          `SELECT (SELECT count(*) FROM orders WHERE id = $1) AS orders,
                    (SELECT count(*) FROM payments WHERE order_id = $1) AS payments`,
          [first.json<OrderView>().id],
        ),
      );
      expect(count.rows[0]).toEqual({ orders: '1', payments: '1' });
    });

    it('vinte envios simultâneos com a mesma chave viram um pedido só', async () => {
      const key = newId();
      const responses = await Promise.all(Array.from({ length: 20 }, () => post(orderBody(store), key)));
      const statuses = responses.map((res) => res.statusCode).sort();
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 200)).toHaveLength(19);
      expect(new Set(responses.map((res) => res.json<OrderView>().id)).size).toBe(1);
    });

    it('a mesma chave com outro conteúdo é recusada', async () => {
      const key = newId();
      await post(orderBody(store), key);
      const res = await post(orderBody(store, { notes: 'mudou' }), key);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'idempotency_key_reused' });
    });

    it('a mesma chave em lojas diferentes cria pedidos diferentes', async () => {
      const other = await createStore(app);
      const key = newId();
      const here = await post(orderBody(store), key);
      const there = await post(orderBody(other), key, other.slug);
      expect([here.statusCode, there.statusCode]).toEqual([201, 201]);
      expect(here.json<OrderView>().id).not.toBe(there.json<OrderView>().id);
    });

    it('pedido recusado não consome a chave', async () => {
      const key = newId();
      const bad = await post(orderBody(store, { items: [{ productId: newId(), quantity: 1 }] }), key);
      expect(bad.statusCode).toBe(422);
      const good = await post(orderBody(store), key);
      expect(good.statusCode).toBe(201);
    });

    it('exige o cabeçalho Idempotency-Key', async () => {
      const res = await post(orderBody(store), null);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'idempotency_key_required' });
    });
  });

  describe('validação', () => {
    it('recusa produto inexistente, inativo ou de outra loja', async () => {
      const other = await createStore(app);
      for (const productId of [newId(), store.menu.inativo, other.menu.refrigerante]) {
        const res = await post(orderBody(store, { items: [{ productId, quantity: 1 }] }));
        expect(res.statusCode, productId).toBe(422);
        expect(res.json()).toMatchObject({ error: 'order_invalid', problems: [{ code: 'product_unavailable' }] });
      }
    });

    it('aplica as regras dos grupos de opções', async () => {
      const cases: Array<[string[], string]> = [
        [[], 'option_group_min'],
        [[store.menu.tamanhoMedia, store.menu.tamanhoGrande], 'option_group_max'],
        [[store.menu.tamanhoMedia, store.menu.calabresaGrande], 'option_unavailable'],
        [[store.menu.tamanhoMedia, store.menu.bacon, store.menu.bacon], 'option_repeated'],
      ];
      for (const [optionIds, code] of cases) {
        const res = await post(
          orderBody(store, { items: [{ productId: store.menu.margherita, quantity: 1, optionIds }] }),
        );
        expect(res.statusCode, code).toBe(422);
        expect(res.json<{ problems: Array<{ code: string }> }>().problems.map((problem) => problem.code)).toContain(
          code,
        );
      }
    });

    it('ignora preço enviado pelo cliente e recusa corpo malformado', async () => {
      const tampered = await post(
        orderBody(store, {
          items: [{ productId: store.menu.refrigerante, quantity: 1, unitPriceCents: 1 }],
          totalCents: 1,
        }),
      );
      expect(tampered.statusCode).toBe(201);
      expect(tampered.json<OrderView>().totalCents).toBe(700);

      const invalid = [
        orderBody(store, { items: [] }),
        orderBody(store, { items: [{ productId: store.menu.refrigerante, quantity: 0 }] }),
        orderBody(store, { items: [{ productId: store.menu.refrigerante, quantity: 1.5 }] }),
        orderBody(store, { customer: { name: 'Maria', phone: '11999990000' } }),
        orderBody(store, { fulfillment: 'delivery' }),
        orderBody(store, { paymentMethod: 'fiado' }),
      ];
      for (const body of invalid) {
        const res = await post(body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect(res.json()).toMatchObject({ error: 'validation_failed' });
      }
    });

    it('loja inexistente e pedido de outra loja respondem 404', async () => {
      expect((await post(orderBody(store), newId(), 'loja-que-nao-existe')).statusCode).toBe(404);

      const other = await createStore(app);
      const order = (await post(orderBody(store))).json<OrderView>();
      const res = await app.inject({ method: 'GET', url: `/v1/stores/${other.slug}/orders/${order.id}` });
      expect(res.statusCode).toBe(404);
      const garbage = await app.inject({ method: 'GET', url: `/v1/stores/${store.slug}/orders/nao-e-um-id` });
      expect(garbage.statusCode).toBe(404);
    });
  });

  it('reaproveita o cliente pelo telefone', async () => {
    await post(orderBody(store, { customer: { name: 'João', phone: '+5511988887777' } }));
    await post(orderBody(store, { customer: { name: 'João Silva', phone: '+5511988887777' } }));
    const customers = await app
      .get(TenantDb)
      .withTenant(store.tenantId, (tx) => tx.query("SELECT name FROM customers WHERE phone = '+5511988887777'"));
    expect(customers.rows).toEqual([{ name: 'João Silva' }]);
  });
});

describe('cardápio e saúde', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await createApiApp();
  });
  afterAll(() => app.close());

  it('serve o cardápio público só com itens ativos e com cabeçalho de cache', async () => {
    const store = await createStore(app);
    const res = await app.inject({ method: 'GET', url: `/v1/stores/${store.slug}/menu` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('s-maxage');
    const menu = res.json();
    expect(menu.store).toEqual({ slug: store.slug, name: `Loja ${store.slug}`, deliveryFeeCents: 600 });
    expect(menu.categories.map((c: { name: string; products: unknown[] }) => [c.name, c.products.length])).toEqual([
      ['Pizzas', 2],
      ['Bebidas', 1],
    ]);
    expect(menu.categories[0].products[0].optionGroups.map((g: { name: string }) => g.name)).toEqual([
      'Tamanho',
      'Adicionais',
    ]);
  });

  it('responde aos testes de vida e de prontidão', async () => {
    expect((await app.inject({ method: 'GET', url: '/health/live' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).json()).toEqual({
      status: 'ok',
      checks: { postgres: 'ok', redis: 'ok' },
    });
  });
});
