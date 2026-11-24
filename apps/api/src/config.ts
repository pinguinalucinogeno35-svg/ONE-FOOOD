import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  REALTIME_PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  DATABASE_URL: z.url(),
  DATABASE_RELAY_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  REDIS_QUEUE_URL: z.url(),
  REDIS_CACHE_URL: z.url(),
  REALTIME_TOKEN_SECRET: z.string().min(32, 'use um segredo de pelo menos 32 caracteres'),
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
