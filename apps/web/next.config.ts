import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A imagem de contêiner do site (Dockerfile.web) usa a saída autônoma: um servidor Node com
  // só os arquivos de que precisa. A raiz do rastreio é a do repositório, por causa do pacote
  // compartilhado. Fora da imagem, o build continua o de sempre.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone' as const, outputFileTracingRoot: join(here, '../..') }
    : {}),
};

export default config;
