import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { APP_POOL, REDIS_QUEUE } from '../tokens.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_POOL) private readonly pool: Pool,
    @Inject(REDIS_QUEUE) private readonly redis: Redis,
  ) {}

  /** O processo está de pé. Não toca em dependências: falha aqui reinicia o contêiner. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Pode receber tráfego. Falha aqui tira a instância do balanceador sem reiniciar. */
  @Get('ready')
  async ready() {
    const [postgres, redis] = await Promise.allSettled([this.pool.query('SELECT 1'), this.redis.ping()]);
    const checks = {
      postgres: postgres.status === 'fulfilled' ? 'ok' : 'down',
      redis: redis.status === 'fulfilled' ? 'ok' : 'down',
    };
    if (checks.postgres !== 'ok' || checks.redis !== 'ok') {
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    }
    return { status: 'ok', checks };
  }
}
