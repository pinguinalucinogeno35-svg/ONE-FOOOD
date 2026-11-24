import { Module } from '@nestjs/common';
import { OutboxWorkerModule } from '../outbox/index.js';
import { RealtimeServer } from './realtime.server.js';
import { RealtimeFanout } from './realtime-fanout.js';

/** Importado pelo processo de workers: assina os eventos e publica para os painéis. */
@Module({
  imports: [OutboxWorkerModule],
  providers: [RealtimeFanout],
})
export class RealtimeFanoutModule {}

/** Importado pelo processo de tempo real: o servidor WebSocket. */
@Module({
  providers: [RealtimeServer],
  exports: [RealtimeServer],
})
export class RealtimeServerModule {}
