import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS_QUEUE } from '../../platform/tokens.js';
import { EventConsumers } from './event-consumers.js';
import { EVENTS_QUEUE, type EventJob, OutboxRelay } from './outbox-relay.service.js';

/**
 * Consome a fila de eventos e entrega cada um aos consumidores registrados.
 * Se um consumidor falhar, a tarefa inteira é repetida com espera crescente:
 * por isso todo consumidor é idempotente.
 */
@Injectable()
export class EventsWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(EventsWorker.name);
  private worker: Worker<EventJob> | null = null;

  constructor(
    @Inject(REDIS_QUEUE) private readonly redis: Redis,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(OutboxRelay) private readonly relay: OutboxRelay,
  ) {}

  start(concurrency = 20): void {
    if (this.worker) return;
    this.worker = new Worker<EventJob>(EVENTS_QUEUE, (job) => this.process(job), {
      connection: this.redis,
      concurrency,
    });
    this.worker.on('failed', (job, error) => {
      this.logger.warn(
        { outboxId: job?.data.outboxId, topic: job?.data.topic, attempt: job?.attemptsMade, err: error },
        'falha ao processar evento',
      );
    });
    this.worker.on('error', (error) => this.logger.error({ err: error }, 'erro no worker de eventos'));
  }

  private async process(job: Job<EventJob>): Promise<void> {
    const { outboxId, tenantId, topic, payload } = job.data;
    for (const { handler } of this.consumers.handlersFor(topic)) {
      await handler({ tenantId, topic, payload } as Parameters<typeof handler>[0]);
    }
    await this.relay.markProcessed(outboxId);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
