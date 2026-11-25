import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /**
   * Endereço em que a API e o tempo real escutam. O padrão atende só IPv4. Onde a rede interna
   * entre os serviços é IPv6, use "::", que no Linux atende os dois.
   */
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  REALTIME_PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  DATABASE_URL: z.url(),
  DATABASE_RELAY_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  REDIS_QUEUE_URL: z.url(),
  REDIS_CACHE_URL: z.url(),
  REALTIME_TOKEN_SECRET: z.string().min(32, 'use um segredo de pelo menos 32 caracteres'),
  /** Endereço público do servidor de tempo real, entregue ao painel junto com o token. */
  REALTIME_PUBLIC_URL: z.url().default('ws://localhost:3001/ws'),
  /** Origem do site. Requisições autenticadas que alteram dados só valem vindas daqui. */
  WEB_ORIGIN: z.url().default('http://localhost:3100'),
  /**
   * Quantos proxies confiáveis ficam na frente da API (balanceador, CDN). Com 0, o IP do
   * cliente é o da conexão. Um valor maior que o real deixa o cliente forjar o próprio IP
   * e escapar dos limites por IP.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  // Limites de uso. 0 desliga o limite (útil no teste de carga em homologação).
  SIGNUP_LIMIT_PER_IP_HOUR: z.coerce.number().int().min(0).default(5),
  LOGIN_LIMIT_PER_ACCOUNT_15MIN: z.coerce.number().int().min(0).default(10),
  ORDER_LIMIT_PER_IP_10MIN: z.coerce.number().int().min(0).default(30),
  ORDER_LIMIT_PER_STORE_MIN: z.coerce.number().int().min(0).default(3000),
  COUPON_PREVIEW_LIMIT_PER_IP_10MIN: z.coerce.number().int().min(0).default(20),
  REVIEW_LIMIT_PER_IP_10MIN: z.coerce.number().int().min(0).default(20),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configuração inválida:\n${problems.join('\n')}`);
  }
  return parsed.data;
}
