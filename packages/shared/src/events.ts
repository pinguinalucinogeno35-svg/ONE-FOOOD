/** Eventos de domínio publicados pelo outbox. O nome do tópico é o contrato entre módulos. */
export interface OrderCreatedEvent {
  orderId: string;
  number: number;
  totalCents: number;
  fulfillment: string;
  paymentMethod: string;
}

export interface OrderStatusChangedEvent {
  orderId: string;
  number: number;
  from: string;
  to: string;
}

export interface ReviewCreatedEvent {
  orderId: string;
  number: number;
  rating: number;
  /** true para nota baixa: o painel destaca na hora. */
  low: boolean;
}

export interface OrderCourierAssignedEvent {
  orderId: string;
  number: number;
  /** null quando o entregador foi retirado do pedido. */
  courierId: string | null;
}

export interface DomainEvents {
  'order.created': OrderCreatedEvent;
  'order.status_changed': OrderStatusChangedEvent;
  'order.courier_assigned': OrderCourierAssignedEvent;
  'review.created': ReviewCreatedEvent;
}
export type DomainTopic = keyof DomainEvents;

/** Mensagem entregue aos painéis pelo processo de tempo real. */
export interface RealtimeMessage<T extends DomainTopic = DomainTopic> {
  type: T;
  data: DomainEvents[T];
}
