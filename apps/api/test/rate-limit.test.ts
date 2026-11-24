import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiModule } from '../src/app.modules.js';
import { trustProxyHops } from '../src/platform/http/trust-proxy.js';
import { newId } from '../src/platform/ids.js';
import { RateLimiter } from '../src/platform/rate-limit/rate-limiter.js';
import { createApiApp, createStore, orderBody } from './helpers.js';

describe('limite de uso', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await createApiApp();
  });
  afterAll(() => app.close());

  it('conta por chave, libera dentro do limite e informa quando tentar de novo', async () => {
    const limiter = app.get(RateLimiter);
    const key = `teste:${newId()}`;
    for (let i = 0; i < 3; i++) expect((await limiter.hit(key, 3, 60)).allowed).toBe(true);
    const blocked = await limiter.hit(key, 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    // Outra chave não é afetada, e limite 0 significa sem limite.
    expect((await limiter.hit(`teste:${newId()}`, 3, 60)).allowed).toBe(true);
    expect((await limiter.hit(key, 0, 60)).allowed).toBe(true);
  });

  it('com o Redis fora do ar, deixa passar em vez de parar os pedidos', async () => {
    const dead = new Redis({
      host: '127.0.0.1',
      port: 1,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.on('error', () => undefined);
    const limiter = new RateLimiter(dead);
    expect(await limiter.hit('qualquer', 1, 60)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    dead.disconnect();
  });
});

describe('limites na criação de pedidos', () => {
  const build = async (env: Record<string, string>, hops: number): Promise<NestFastifyApplication> => {
    const previous = { ...process.env };
    Object.assign(process.env, env);
    try {
      const app = await NestFactory.create<NestFastifyApplication>(
        ApiModule,
        new FastifyAdapter({ trustProxy: trustProxyHops(hops) }),
        { logger: false },
      );
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      return app;
    } finally {
      process.env = previous;
    }
  };
  const order = (app: NestFastifyApplication, slug: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: `/v1/stores/${slug}/orders`,
      headers: { 'idempotency-key': newId(), ...headers },
      payload: body as object,
    });

  it('segura pedidos em massa do mesmo IP sem afetar outros clientes nem outras lojas', async () => {
    const app = await build({ ORDER_LIMIT_PER_IP_10MIN: '3' }, 0);
    try {
      const store = await createStore(app);
      const other = await createStore(app);
      for (let i = 0; i < 3; i++) expect((await order(app, store.slug, orderBody(store))).statusCode).toBe(201);
      const blocked = await order(app, store.slug, orderBody(store));
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toMatchObject({ error: 'rate_limited' });

      // Sem proxy confiável declarado, forjar o cabeçalho não muda o IP contado.
      const spoofed = await order(app, store.slug, orderBody(store), { 'x-forwarded-for': '203.0.113.9' });
      expect(spoofed.statusCode).toBe(429);
      // O mesmo IP ainda pede em outra loja.
      expect((await order(app, other.slug, orderBody(other))).statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });

  it('atrás de um proxy confiável, conta o IP real de cada cliente', async () => {
    const app = await build({ ORDER_LIMIT_PER_IP_10MIN: '1' }, 1);
    try {
      const store = await createStore(app);
      const from = (ip: string) => order(app, store.slug, orderBody(store), { 'x-forwarded-for': ip });
      expect((await from('198.51.100.1')).statusCode).toBe(201);
      expect((await from('198.51.100.1')).statusCode).toBe(429);
      expect((await from('198.51.100.2')).statusCode).toBe(201);
      // O cliente não escapa acrescentando um IP falso antes do verdadeiro.
      expect((await from('10.9.9.9, 198.51.100.1')).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('limita o volume por loja, protegendo as demais', async () => {
    const app = await build({ ORDER_LIMIT_PER_STORE_MIN: '2' }, 0);
    try {
      const store = await createStore(app);
      const other = await createStore(app);
      expect((await order(app, store.slug, orderBody(store))).statusCode).toBe(201);
      expect((await order(app, store.slug, orderBody(store))).statusCode).toBe(201);
      expect((await order(app, store.slug, orderBody(store))).statusCode).toBe(429);
      expect((await order(app, other.slug, orderBody(other))).statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });
});
