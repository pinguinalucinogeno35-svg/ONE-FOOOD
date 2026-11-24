import { Injectable } from '@nestjs/common';
import type { DomainEvents, DomainTopic } from '@onefood/shared';
import type { TenantTx } from '../../platform/db/tenant-db.js';

/**
 * Padrão outbox. O evento é gravado na mesma transação da mudança que o causou,
 * então nenhum evento se perde se o processo cair logo depois do COMMIT.
 */
@Injectable()
export class Outbox {
  async emit<T extends DomainTopic>(tx: TenantTx, topic: T, payload: DomainEvents[T]): Promise<void> {
    await tx.query('INSERT INTO outbox (tenant_id, topic, payload) VALUES ($1, $2, $3)', [
      tx.tenantId,
      topic,
      JSON.stringify(payload),
    ]);
  }
}
