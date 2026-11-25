import { z } from 'zod';
import type { DeliveryAddress, OrderStatus, PaymentMethod } from './orders.js';
import { phoneSchema } from './orders.js';

/** Valor pago ao entregador por entrega. null = ele recebe a taxa de entrega de cada pedido. */
const feePerDelivery = z.number().int().min(0).max(1_000_00).nullable();

export const createCourierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  feePerDeliveryCents: feePerDelivery.default(null),
});
export type CreateCourierInput = z.infer<typeof createCourierSchema>;

export const updateCourierSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: phoneSchema,
    active: z.boolean(),
    feePerDeliveryCents: feePerDelivery,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'nada para alterar');
export type UpdateCourierInput = z.infer<typeof updateCourierSchema>;

/** null tira o entregador do pedido. */
export const assignCourierSchema = z.object({ courierId: z.uuid().nullable() });

/** O entregador só faz duas mudanças: saiu para entrega e entregou. */
export const courierStatusSchema = z.object({ status: z.enum(['out_for_delivery', 'completed']) });

export const courierPositionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Margem de erro informada pelo aparelho, em metros. */
  accuracy: z.number().min(0).max(100_000).optional(),
});
export type CourierPositionInput = z.infer<typeof courierPositionSchema>;

export interface CourierView {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  feePerDeliveryCents: number | null;
}

/** Devolvido só na criação e na troca do link: o token não fica guardado em lugar nenhum. */
export interface CourierAccessView {
  id: string;
  accessToken: string;
}

export interface CourierPosition {
  lat: number;
  lng: number;
  accuracy: number | null;
  recordedAt: string;
}

/** O que o entregador vê de uma entrega: o necessário para levar e receber. */
export interface CourierDeliveryView {
  orderId: string;
  number: number;
  status: OrderStatus;
  customer: { name: string; phone: string };
  address: DeliveryAddress;
  notes: string | null;
  paymentMethod: PaymentMethod;
  totalCents: number;
  itemsSummary: string;
}

export interface CourierHomeView {
  courier: { name: string };
  store: { name: string };
  deliveries: CourierDeliveryView[];
  /** O que está pendente de acerto com o restaurante. */
  settlement: SettlementTotals;
}

/** Totais de um acerto, pendente ou já fechado. */
export interface SettlementTotals {
  deliveries: number;
  /** A pagar ao entregador pelas entregas. */
  feesCents: number;
  /** Dinheiro que o entregador recebeu dos clientes. */
  cashCents: number;
}

/**
 * Saldo do acerto. Positivo: o entregador repassa ao restaurante. Negativo: o restaurante
 * paga ao entregador.
 */
export function settlementNetCents(totals: SettlementTotals): number {
  return totals.cashCents - totals.feesCents;
}

export const closeSettlementSchema = z.object({
  courierId: z.uuid(),
  note: z.string().trim().max(300).optional(),
});

export interface PendingSettlementView extends SettlementTotals {
  courierId: string;
  courierName: string;
  /** Data da entrega mais antiga ainda não acertada. */
  since: string;
}

export interface ClosedSettlementView extends SettlementTotals {
  id: string;
  courierId: string;
  courierName: string;
  createdAt: string;
  note: string | null;
}

export interface SettlementsView {
  pending: PendingSettlementView[];
  recent: ClosedSettlementView[];
}

/** O que o cliente vê do entregador: primeiro nome e, durante a entrega, onde ele está. */
export interface TrackedCourierView {
  name: string;
  position: CourierPosition | null;
}

/** Posição com mais tempo que isto não é mostrada ao cliente. */
export const COURIER_POSITION_MAX_AGE_SECONDS = 300;
