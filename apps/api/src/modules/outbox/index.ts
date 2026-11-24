/** Interface pública do módulo de outbox. Outros módulos importam só daqui. */
export { type ConsumedEvent, EventConsumers, type EventHandler } from './event-consumers.js';
export { EventsWorker } from './events.worker.js';
export { OutboxModule, OutboxWorkerModule } from './outbox.module.js';
export { Outbox } from './outbox.service.js';
export { EVENTS_QUEUE, type EventJob, OutboxRelay } from './outbox-relay.service.js';
