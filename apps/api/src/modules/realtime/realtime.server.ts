import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { type WebSocket, WebSocketServer } from 'ws';
import type { Config } from '../../config.js';
import { CONFIG, REDIS_CACHE } from '../../platform/tokens.js';
import { verifyRealtimeToken } from './realtime-token.js';

const CHANNEL_PREFIX = 'rt:';
const HEARTBEAT_MS = 30_000;

/**
 * Processo de tempo real: mantém as conexões WebSocket dos painéis e do monitor de cozinha
 * e repassa o que os workers publicam no Redis. Não guarda estado e não toca o banco,
 * então escala só somando instâncias.
 */
@Injectable()
export class RealtimeServer implements OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeServer.name);
  private readonly socketsByTenant = new Map<string, Set<WebSocket>>();
  private readonly alive = new WeakSet<WebSocket>();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 1_024 });
  private http: Server | null = null;
  private subscriber: Redis | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  /** Sobe o servidor e devolve a porta em uso (útil quando a porta pedida é 0). */
  async listen(port = this.config.REALTIME_PORT): Promise<number> {
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      this.broadcast(channel.slice(CHANNEL_PREFIX.length), message);
    });
    await this.subscriber.psubscribe(`${CHANNEL_PREFIX}*`);

    this.http = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health/live') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
        return;
      }
      res.writeHead(404).end();
    });
    this.http.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));

    this.heartbeat = setInterval(() => this.checkConnections(), HEARTBEAT_MS);
    this.heartbeat.unref();

    const http = this.http;
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(port, '0.0.0.0', resolve);
    });
    return (http.address() as AddressInfo).port;
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token');
    const tenantId =
      url.pathname === '/ws' && token ? verifyRealtimeToken(this.config.REALTIME_TOKEN_SECRET, token) : null;
    if (!tenantId) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const sockets = this.socketsByTenant.get(tenantId) ?? new Set<WebSocket>();
      sockets.add(ws);
      this.socketsByTenant.set(tenantId, sockets);
      this.alive.add(ws);

      ws.on('pong', () => this.alive.add(ws));
      ws.on('error', () => ws.terminate());
      ws.on('close', () => {
        sockets.delete(ws);
        if (sockets.size === 0) this.socketsByTenant.delete(tenantId);
      });
    });
  }

  private broadcast(tenantId: string, message: string): void {
    const sockets = this.socketsByTenant.get(tenantId);
    if (!sockets) return;
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(message);
    }
  }

  /** Derruba conexões que não responderam ao último ping (aba fechada, rede caiu). */
  private checkConnections(): void {
    for (const ws of this.wss.clients) {
      if (!this.alive.has(ws)) {
        ws.terminate();
        continue;
      }
      this.alive.delete(ws);
      ws.ping();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const ws of this.wss.clients) ws.close(1001, 'servidor reiniciando');
    this.wss.close();
    const http = this.http;
    if (http) await new Promise<void>((resolve) => http.close(() => resolve()));
    await this.subscriber?.quit().catch((error) => this.logger.warn({ err: error }, 'falha ao fechar o assinante'));
  }
}
