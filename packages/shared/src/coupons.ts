import { z } from 'zod';

export const COUPON_KINDS = ['percent', 'fixed'] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

/** Código como o cliente digita: sem espaços, em maiúsculas. */
export const couponCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{3,20}$/, 'use de 3 a 20 letras e números'));

const cents = z.number().int().min(0).max(100_000_00);
const instant = z.iso.datetime({ offset: true });

const couponFields = z.object({
  code: couponCodeSchema,
  kind: z.enum(COUPON_KINDS),
  /** Porcentagem (1 a 100) ou valor em centavos, conforme o tipo. */
  value: z.number().int().min(1).max(100_000_00),
  minOrderCents: cents.default(0),
  maxDiscountCents: cents.min(1).nullable().default(null),
  startsAt: instant.nullable().default(null),
  endsAt: instant.nullable().default(null),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().default(null),
  oncePerCustomer: z.boolean().default(true),
});

export const createCouponSchema = couponFields
  .refine((coupon) => coupon.kind !== 'percent' || coupon.value <= 100, {
    path: ['value'],
    message: 'a porcentagem vai de 1 a 100',
  })
  .refine((coupon) => !coupon.startsAt || !coupon.endsAt || coupon.endsAt > coupon.startsAt, {
    path: ['endsAt'],
    message: 'o fim precisa vir depois do início',
  });
export type CreateCouponInput = z.infer<typeof createCouponSchema>;

/** Depois de criado, o cupom só pode ser ligado ou desligado: mudar as regras confundiria quem já usou. */
export const updateCouponSchema = z.object({ active: z.boolean() });

export const previewCouponSchema = z.object({ code: couponCodeSchema, subtotalCents: cents });

export interface CouponView {
  id: string;
  code: string;
  kind: CouponKind;
  value: number;
  minOrderCents: number;
  maxDiscountCents: number | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  oncePerCustomer: boolean;
  active: boolean;
  redemptions: number;
}

export interface CouponPreview {
  code: string;
  discountCents: number;
}

export const COUPON_PROBLEMS = [
  'not_found',
  'inactive',
  'not_started',
  'expired',
  'min_order',
  'exhausted',
  'already_used',
] as const;
export type CouponProblem = (typeof COUPON_PROBLEMS)[number];

/**
 * Desconto de um cupom sobre o valor dos itens. A taxa de entrega nunca entra na conta.
 * Cupom percentual arredonda para baixo e respeita o teto; cupom de valor fixo não passa do subtotal.
 */
export function couponDiscount(
  coupon: { kind: CouponKind; value: number; maxDiscountCents: number | null },
  subtotalCents: number,
): number {
  if (coupon.kind === 'fixed') return Math.min(coupon.value, subtotalCents);
  const raw = Math.floor((subtotalCents * coupon.value) / 100);
  return coupon.maxDiscountCents === null ? raw : Math.min(raw, coupon.maxDiscountCents);
}
