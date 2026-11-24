import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { RealtimeModule } from './app.modules.js';
import { RealtimeServer } from './modules/realtime/index.js';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(RealtimeModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const port = await app.get(RealtimeServer).listen();
  app.get(Logger).log(`tempo real no ar na porta ${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
