import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import pg from 'pg';
import { type Config, loadConfig } from '../config.js';
import { PartitionsService } from './db/partitions.service.js';
import { TenantDb } from './db/tenant-db.js';
import { RateLimiter } from './rate-limit/rate-limiter.js';
import { TenantsService } from './tenants/tenants.service.js';
import { APP_POOL, CONFIG, REDIS_CACHE, REDIS_QUEUE, RELAY_POOL } from './tokens.js';

function createPool(connectionString: string, max: number, name: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    application_name: name,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // Erro em conexão ociosa não pode derrubar o processo.
  pool.on('error', () => undefined);
  return pool;
}

/**
 * Infraestrutura compartilhada pelos três processos (API, workers, tempo real):
 * configuração, log, pools do Postgres e clientes Redis.
 */
@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: Config) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          // Nunca registrar dados pessoais nem credenciais.
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
        },
      }),
    }),
  ],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: APP_POOL,
      inject: [CONFIG],
      useFactory: (config: Config) => createPool(config.DATABASE_URL, config.DATABASE_POOL_MAX, 'onefood-app'),
    },
    {
      provide: RELAY_POOL,
      inject: [CONFIG],
      useFactory: (config: Config) => createPool(config.DATABASE_RELAY_URL, 2, 'onefood-relay'),
    },
    {
      provide: REDIS_QUEUE,
      inject: [CONFIG],
      // BullMQ exige maxRetriesPerRequest nulo nas conexões que bloqueiam.
      useFactory: (config: Config) => new Redis(config.REDIS_QUEUE_URL, { maxRetriesPerRequest: null }),
    },
    {
      provide: REDIS_CACHE,
      inject: [CONFIG],
      useFactory: (config: Config) => new Redis(config.REDIS_CACHE_URL, { maxRetriesPerRequest: 2 }),
    },
    TenantDb,
    TenantsService,
    PartitionsService,
    RateLimiter,
  ],
  exports: [
    CONFIG,
    APP_POOL,
    RELAY_POOL,
    REDIS_QUEUE,
    REDIS_CACHE,
    TenantDb,
    TenantsService,
    PartitionsService,
    RateLimiter,
  ],
})
export class PlatformModule implements OnApplicationShutdown {
  constructor(
    @Inject(APP_POOL) private readonly appPool: pg.Pool,
    @Inject(RELAY_POOL) private readonly relayPool: pg.Pool,
    @Inject(REDIS_QUEUE) private readonly redisQueue: Redis,
    @Inject(REDIS_CACHE) private readonly redisCache: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([
      this.appPool.end(),
      this.relayPool.end(),
      this.redisQueue.quit(),
      this.redisCache.quit(),
    ]);
  }
}
