import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { ApiModule } from './app.modules.js';
import type { Config } from './config.js';
import { CONFIG } from './platform/tokens.js';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule,
    // Atrás de balanceador: o IP do cliente vem do cabeçalho encaminhado.
    new FastifyAdapter({ trustProxy: true, bodyLimit: 256 * 1024 }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const config = app.get<Config>(CONFIG);
  await app.listen(config.PORT, '0.0.0.0');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
