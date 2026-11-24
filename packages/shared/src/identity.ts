import { z } from 'zod';

export const ROLES = ['owner', 'manager', 'staff'] as const;
export type Role = (typeof ROLES)[number];

/** Endereços que o site usa para as próprias páginas e que, por isso, não podem ser de uma loja. */
export const RESERVED_SLUGS = [
  'api',
  'app',
  'admin',
  'painel',
  'entrar',
  'sair',
  'cadastro',
  'conta',
  'ajuda',
  'pedido',
  'vitrine',
  'www',
] as const;

export const slugSchema = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use letras minúsculas, números e hífen')
  .refine((slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug), 'este endereço é reservado');

const emailSchema = z
  .string()
  .trim()
  .max(254)
  .transform((value) => value.toLowerCase())
  .pipe(z.email('e-mail inválido'));

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: z.string().min(10, 'a senha precisa de pelo menos 10 caracteres').max(200),
  storeName: z.string().trim().min(1).max(120),
  storeSlug: slugSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface MeView {
  user: { id: string; name: string; email: string };
  stores: Array<{ slug: string; name: string; role: Role }>;
}
