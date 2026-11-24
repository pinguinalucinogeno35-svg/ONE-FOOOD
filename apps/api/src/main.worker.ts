import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './app.modules.js';
import { EventsWorker, OutboxRelay } from './modules/outbox/index.js';
import { PartitionsService } from './platform/db/partitions.service.js';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  app.get(PartitionsService).start();
  app.get(EventsWorker).start();
  app.get(OutboxRelay).start();
  app.get(Logger).log('workers no ar');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
