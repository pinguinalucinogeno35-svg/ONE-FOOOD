import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Valida o corpo com o mesmo esquema que o site usa. Corpo inválido vira 400 com os campos. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      error: 'validation_failed',
      problems: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), detail: issue.message })),
    });
  }
  return parsed.data;
}
