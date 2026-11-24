import { z } from 'zod';
import type { DeliveryAddress, OrderStatus, PaymentMethod } from './orders.js';
import { phoneSchema } from './orders.js';

export const createCourierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: phoneSchema,
});
export type CreateCourierInput = z.infer<typeof createCourierSchema>;

export const updateCourierSchema = z
  .object({ name: z.string().trim().min(1).max(120), phone: phoneSchema, active: z.boolean() })
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
}

/** O que o cliente vê do entregador: primeiro nome e, durante a entrega, onde ele está. */
export interface TrackedCourierView {
  name: string;
  position: CourierPosition | null;
}

/** Posição com mais tempo que isto não é mostrada ao cliente. */
export const COURIER_POSITION_MAX_AGE_SECONDS = 300;
