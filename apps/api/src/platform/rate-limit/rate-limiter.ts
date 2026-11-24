import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CACHE } from '../tokens.js';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Limite de uso por janela fixa, contado no Redis de cache.
 *
 * Se o Redis estiver fora do ar, o limite deixa passar: perder a proteção por alguns
 * minutos é melhor do que parar de receber pedidos.
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  constructor(@Inject(REDIS_CACHE) private readonly redis: Redis) {}

  /** limit 0 significa sem limite. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    if (limit <= 0) return { allowed: true, retryAfterSeconds: 0 };
    const redisKey = `rl:${key}`;
    try {
      const results = await this.redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, windowSeconds, 'NX')
        .ttl(redisKey)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
      return { allowed: count <= limit, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
    } catch (error) {
      this.logger.warn({ err: error }, 'limite de uso indisponível; deixando passar');
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  /** Conta o uso e responde 429 se o limite estourou. */
  async enforce(key: string, limit: number, windowSeconds: number): Promise<void> {
    const result = await this.hit(key, limit, windowSeconds);
    if (!result.allowed) {
      throw new HttpException(
        { error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
