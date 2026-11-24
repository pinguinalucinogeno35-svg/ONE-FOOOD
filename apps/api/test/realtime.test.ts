import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { RealtimeModule } from '../src/app.modules.js';
import {
  RealtimeServer,
  realtimeChannel,
  signRealtimeToken,
  verifyRealtimeToken,
} from '../src/modules/realtime/index.js';
import { newId } from '../src/platform/ids.js';
import { REDIS_CACHE } from '../src/platform/tokens.js';
import { waitFor } from './helpers.js';

const SECRET = process.env.REALTIME_TOKEN_SECRET as string;

describe('token de tempo real', () => {
  it('aceita só token íntegro, do segredo certo e dentro do prazo', () => {
    const tenantId = newId();
    const token = signRealtimeToken(SECRET, tenantId, 60);
    expect(verifyRealtimeToken(SECRET, token)).toBe(tenantId);
    expect(verifyRealtimeToken('outro-segredo-qualquer-com-tamanho-ok', token)).toBeNull();
    expect(verifyRealtimeToken(SECRET, token, Date.now() + 61_000)).toBeNull();
    expect(verifyRealtimeToken(SECRET, '')).toBeNull();
    expect(verifyRealtimeToken(SECRET, 'v1.abc')).toBeNull();

    // Trocar o tenant mantendo a assinatura antiga não passa.
    const [version, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ t: newId(), e: 9_999_999_999 })).toString('base64url');
    expect(verifyRealtimeToken(SECRET, `${version}.${forged}.${signature}`)).toBeNull();
  });
});

describe('servidor de tempo real', () => {
  let app: INestApplicationContext;
  let port: number;
  let redis: Redis;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(RealtimeModule, { logger: false });
    port = await app.get(RealtimeServer).listen(0);
    redis = app.get<Redis>(REDIS_CACHE);
  });
  afterAll(async () => {
    for (const ws of sockets) ws.terminate();
    await app.close();
  });

  const connect = (query: string): Promise<{ ws: WebSocket; messages: string[] }> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
      sockets.push(ws);
      const messages: string[] = [];
      ws.on('message', (data) => messages.push(data.toString()));
      ws.once('open', () => resolve({ ws, messages }));
      ws.once('error', reject);
    });

  it('recusa conexão sem token válido', async () => {
    await expect(connect('')).rejects.toThrow(/401/);
    await expect(connect('?token=v1.invalido.invalido')).rejects.toThrow(/401/);
    const expired = signRealtimeToken(SECRET, newId(), 60, Date.now() - 120_000);
    await expect(connect(`?token=${expired}`)).rejects.toThrow(/401/);
  });

  it('entrega a cada painel só os avisos do próprio tenant', async () => {
    const tenantA = newId();
    const tenantB = newId();
    const a = await connect(`?token=${signRealtimeToken(SECRET, tenantA)}`);
    const b = await connect(`?token=${signRealtimeToken(SECRET, tenantB)}`);

    await redis.publish(realtimeChannel(tenantA), '{"type":"order.created","data":{"orderId":"a"}}');
    await redis.publish(realtimeChannel(tenantB), '{"type":"order.created","data":{"orderId":"b"}}');

    await waitFor(async () => a.messages.length === 1 && b.messages.length === 1);
    expect(a.messages).toEqual(['{"type":"order.created","data":{"orderId":"a"}}']);
    expect(b.messages).toEqual(['{"type":"order.created","data":{"orderId":"b"}}']);
  });

  it('responde ao teste de vida', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health/live`);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
