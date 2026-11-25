import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { ApiModule } from './app.modules.js';
import { loadConfig } from './config.js';
import { trustProxyHops } from './platform/http/trust-proxy.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule,
    // O IP do cliente só vem do cabeçalho encaminhado quando há proxies confiáveis declarados.
    new FastifyAdapter({
      trustProxy: trustProxyHops(config.TRUST_PROXY_HOPS),
      bodyLimit: 256 * 1024,
    }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  await app.listen(config.PORT, config.HOST);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
