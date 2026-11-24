import { Module } from '@nestjs/common';
import { CatalogModule } from './modules/catalog/index.js';
import { OrdersModule } from './modules/orders/index.js';
import { OutboxWorkerModule } from './modules/outbox/index.js';
import { RealtimeFanoutModule, RealtimeServerModule } from './modules/realtime/index.js';
import { HealthController } from './platform/health/health.controller.js';
import { PlatformModule } from './platform/platform.module.js';

/**
 * Um código, três processos. Cada processo monta só os módulos de que precisa
 * e escala de forma independente.
 */

/** API: só o que precisa ser imediato. Nada aqui espera por terceiros. */
@Module({
  imports: [PlatformModule, CatalogModule, OrdersModule],
  controllers: [HealthController],
})
export class ApiModule {}

/** Workers: relay do outbox, consumidores de eventos e manutenção de partições. */
@Module({
  imports: [PlatformModule, OutboxWorkerModule, RealtimeFanoutModule],
})
export class WorkerModule {}

/** Tempo real: conexões WebSocket dos painéis. */
@Module({
  imports: [PlatformModule, RealtimeServerModule],
})
export class RealtimeModule {}
