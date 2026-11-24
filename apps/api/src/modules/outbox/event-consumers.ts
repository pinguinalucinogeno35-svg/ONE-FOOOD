import { Injectable } from '@nestjs/common';
import type { DomainEvents, DomainTopic } from '@onefood/shared';

export interface ConsumedEvent<T extends DomainTopic = DomainTopic> {
  tenantId: string;
  topic: T;
  payload: DomainEvents[T];
}

export type EventHandler<T extends DomainTopic = DomainTopic> = (event: ConsumedEvent<T>) => Promise<void>;

interface Registration {
  name: string;
  handler: EventHandler;
}

/**
 * Onde os módulos assinam eventos de outros módulos. É a única ligação entre eles
 * além das interfaces públicas.
 *
 * Todo handler precisa ser idempotente: o mesmo evento pode chegar mais de uma vez
 * (nova tentativa, reconciliação depois de um failover do Redis).
 */
@Injectable()
export class EventConsumers {
  private readonly registry = new Map<string, Registration[]>();

  on<T extends DomainTopic>(topic: T, name: string, handler: EventHandler<T>): void {
    const list = this.registry.get(topic) ?? [];
    if (list.some((registration) => registration.name === name)) {
      throw new Error(`consumidor duplicado para ${topic}: ${name}`);
    }
    list.push({ name, handler: handler as unknown as EventHandler });
    this.registry.set(topic, list);
  }

  handlersFor(topic: string): readonly Registration[] {
    return this.registry.get(topic) ?? [];
  }
}
