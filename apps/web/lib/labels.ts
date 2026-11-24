import type { Fulfillment, OrderStatus, PaymentMethod } from '@onefood/shared';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Recebido',
  confirmed: 'Confirmado',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

/** Texto do botão que leva o pedido para cada estado. */
export const ACTION_LABEL: Record<OrderStatus, string> = {
  pending: 'Reabrir',
  confirmed: 'Confirmar',
  preparing: 'Iniciar preparo',
  ready: 'Marcar como pronto',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Concluir',
  cancelled: 'Cancelar',
};

export const FULFILLMENT_LABEL: Record<Fulfillment, string> = {
  delivery: 'Entrega',
  pickup: 'Retirada',
  dine_in: 'No local',
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  card_on_delivery: 'Cartão na entrega',
  cash: 'Dinheiro',
};

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}
