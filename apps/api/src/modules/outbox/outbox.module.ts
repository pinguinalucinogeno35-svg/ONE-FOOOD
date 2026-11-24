import { Module } from '@nestjs/common';
import { EventConsumers } from './event-consumers.js';
import { EventsWorker } from './events.worker.js';
import { Outbox } from './outbox.service.js';
import { OutboxRelay } from './outbox-relay.service.js';

/** Lado de quem emite eventos. É o que a API usa. */
@Module({
  providers: [Outbox],
  exports: [Outbox],
})
export class OutboxModule {}

/** Lado de quem publica e consome. Só o processo de workers importa este módulo. */
@Module({
  providers: [EventConsumers, OutboxRelay, EventsWorker],
  exports: [EventConsumers, OutboxRelay, EventsWorker],
})
export class OutboxWorkerModule {}
