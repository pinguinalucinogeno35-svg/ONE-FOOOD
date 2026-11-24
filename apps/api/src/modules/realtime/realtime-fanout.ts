import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { RealtimeMessage } from '@onefood/shared';
import type { Redis } from 'ioredis';
import { REDIS_CACHE } from '../../platform/tokens.js';
import { EventConsumers } from '../outbox/index.js';

export function realtimeChannel(tenantId: string): string {
  return `rt:${tenantId}`;
}

/**
 * Roda no processo de workers: transforma eventos de domínio em mensagens para os painéis.
 * Publicar duas vezes só faz o painel receber o mesmo aviso de novo, então é idempotente.
 */
@Injectable()
export class RealtimeFanout implements OnModuleInit {
  constructor(
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.consumers.on('order.created', 'realtime', async (event) => {
      const message: RealtimeMessage<'order.created'> = { type: 'order.created', data: event.payload };
      await this.redis.publish(realtimeChannel(event.tenantId), JSON.stringify(message));
    });
    this.consumers.on('review.created', 'realtime', async (event) => {
      const message: RealtimeMessage<'review.created'> = { type: 'review.created', data: event.payload };
      await this.redis.publish(realtimeChannel(event.tenantId), JSON.stringify(message));
    });
    this.consumers.on('order.status_changed', 'realtime', async (event) => {
      const message: RealtimeMessage<'order.status_changed'> = { type: 'order.status_changed', data: event.payload };
      await this.redis.publish(realtimeChannel(event.tenantId), JSON.stringify(message));
    });
  }
}
