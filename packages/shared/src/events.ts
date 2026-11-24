/** Eventos de domínio publicados pelo outbox. O nome do tópico é o contrato entre módulos. */
export interface OrderCreatedEvent {
  orderId: string;
  number: number;
  totalCents: number;
  fulfillment: string;
  paymentMethod: string;
}

export interface DomainEvents {
  'order.created': OrderCreatedEvent;
}
export type DomainTopic = keyof DomainEvents;

/** Mensagem entregue aos painéis pelo processo de tempo real. */
export interface RealtimeMessage<T extends DomainTopic = DomainTopic> {
  type: T;
  data: DomainEvents[T];
}
