import { z } from 'zod';

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILLMENTS = ['delivery', 'pickup', 'dine_in'] as const;
export type Fulfillment = (typeof FULFILLMENTS)[number];

export const PAYMENT_METHODS = ['pix', 'card_on_delivery', 'cash'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ORDER_CHANNELS = ['web', 'whatsapp', 'pos'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** Telefone em E.164, por exemplo +5511999990000. */
export const phoneSchema = z.string().regex(/^\+[1-9]\d{9,14}$/, 'telefone deve estar no formato E.164');

export const deliveryAddressSchema = z.object({
  street: z.string().trim().min(1).max(200),
  number: z.string().trim().min(1).max(20),
  complement: z.string().trim().max(100).optional(),
  district: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2),
  postalCode: z.string().regex(/^\d{8}$/, 'CEP deve ter 8 dígitos'),
  reference: z.string().trim().max(200).optional(),
});
export type DeliveryAddress = z.infer<typeof deliveryAddressSchema>;

export const createOrderItemSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(99),
  optionIds: z.array(z.uuid()).max(30).default([]),
  notes: z.string().trim().max(300).optional(),
});

/**
 * O cliente nunca envia preço. Os valores são calculados no servidor a partir do catálogo.
 */
export const createOrderSchema = z
  .object({
    customer: z.object({
      name: z.string().trim().min(1).max(120),
      phone: phoneSchema,
    }),
    fulfillment: z.enum(FULFILLMENTS),
    paymentMethod: z.enum(PAYMENT_METHODS),
    items: z.array(createOrderItemSchema).min(1).max(100),
    deliveryAddress: deliveryAddressSchema.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((order) => order.fulfillment !== 'delivery' || order.deliveryAddress !== undefined, {
    path: ['deliveryAddress'],
    message: 'endereço é obrigatório para entrega',
  });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export interface OrderItemOptionView {
  optionId: string;
  groupName: string;
  name: string;
  priceDeltaCents: number;
}

export interface OrderItemView {
  lineNo: number;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  options: OrderItemOptionView[];
  totalCents: number;
  notes: string | null;
}

export interface OrderView {
  id: string;
  number: number;
  status: OrderStatus;
  channel: OrderChannel;
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
  notes: string | null;
  createdAt: string;
  items: OrderItemView[];
}
