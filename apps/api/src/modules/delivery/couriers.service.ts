import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  COURIER_POSITION_MAX_AGE_SECONDS,
  type CourierAccessView,
  type CourierPosition,
  type CourierPositionInput,
  type CourierView,
  type CreateCourierInput,
  type UpdateCourierInput,
} from '@onefood/shared';
import type { Redis } from 'ioredis';
import { TenantDb, type TenantTx } from '../../platform/db/tenant-db.js';
import { newId } from '../../platform/ids.js';
import { REDIS_CACHE } from '../../platform/tokens.js';

/** Quem é o dono de um link de entregador. */
export interface CourierIdentity {
  tenantId: string;
  courierId: string;
  name: string;
  storeName: string;
}

const COLUMNS: Record<keyof UpdateCourierInput, string> = {
  name: 'name',
  phone: 'phone',
  active: 'active',
  feePerDeliveryCents: 'fee_per_delivery_cents',
};

/**
 * Cadastro dos entregadores, link de acesso e última posição.
 *
 * A posição é dado pessoal do entregador: só a última fica guardada, no Redis de cache e
 * com prazo de validade. Não existe histórico de trajeto.
 */
@Injectable()
export class CouriersService {
  private readonly logger = new Logger(CouriersService.name);

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  async list(tenantId: string): Promise<CourierView[]> {
    const { rows } = await this.db.withTenant(tenantId, (tx) =>
      tx.query<{ id: string; name: string; phone: string; active: boolean; fee_per_delivery_cents: number | null }>(
        `SELECT id, name, phone, active, fee_per_delivery_cents
           FROM couriers WHERE tenant_id = $1 ORDER BY active DESC, name`,
        [tenantId],
      ),
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      active: row.active,
      feePerDeliveryCents: row.fee_per_delivery_cents,
    }));
  }

  async create(tenantId: string, input: CreateCourierInput): Promise<CourierAccessView> {
    const id = newId();
    const accessToken = newToken();
    try {
      await this.db.withTenant(tenantId, (tx) =>
        tx.query(
          `INSERT INTO couriers (tenant_id, id, name, phone, access_token_hash, fee_per_delivery_cents)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, id, input.name, input.phone, hashToken(accessToken), input.feePerDeliveryCents],
        ),
      );
    } catch (error) {
      throw phoneTaken(error);
    }
    return { id, accessToken };
  }

  async update(tenantId: string, courierId: string, patch: UpdateCourierInput): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [tenantId, courierId];
    for (const [field, column] of Object.entries(COLUMNS) as Array<[keyof UpdateCourierInput, string]>) {
      if (patch[field] === undefined) continue;
      values.push(patch[field]);
      sets.push(`${column} = $${values.length}`);
    }
    try {
      const updated = await this.db.withTenant(tenantId, (tx) =>
        tx.query(`UPDATE couriers SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2`, values),
      );
      if (updated.rowCount === 0) throw courierNotFound();
    } catch (error) {
      throw phoneTaken(error);
    }
    // Entregador desligado some do mapa na hora.
    if (patch.active === false) await this.clearPosition(tenantId, courierId);
  }

  /** Troca o link do entregador. O link antigo para de funcionar imediatamente. */
  async rotateAccess(tenantId: string, courierId: string): Promise<CourierAccessView> {
    const accessToken = newToken();
    const updated = await this.db.withTenant(tenantId, (tx) =>
      tx.query('UPDATE couriers SET access_token_hash = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2', [
        tenantId,
        courierId,
        hashToken(accessToken),
      ]),
    );
    if (updated.rowCount === 0) throw courierNotFound();
    return { id: courierId, accessToken };
  }

  async resolveToken(accessToken: string): Promise<CourierIdentity | null> {
    const { rows } = await this.db.platformQuery<{
      tenant_id: string;
      courier_id: string;
      courier_name: string;
      store_name: string;
    }>('SELECT * FROM app.resolve_courier($1)', [hashToken(accessToken)]);
    const row = rows[0];
    return row
      ? { tenantId: row.tenant_id, courierId: row.courier_id, name: row.courier_name, storeName: row.store_name }
      : null;
  }

  /** Confere, dentro da transação de quem chama, que o entregador existe e está ativo. */
  async requireActive(tx: TenantTx, courierId: string): Promise<{ id: string; name: string }> {
    const { rows } = await tx.query<{ id: string; name: string; active: boolean }>(
      'SELECT id, name, active FROM couriers WHERE tenant_id = $1 AND id = $2',
      [tx.tenantId, courierId],
    );
    const courier = rows[0];
    if (!courier) throw courierNotFound();
    if (!courier.active) throw new ConflictException({ error: 'courier_inactive' });
    return { id: courier.id, name: courier.name };
  }

  async namesOf(tx: TenantTx, courierIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(courierIds)];
    if (ids.length === 0) return new Map();
    const { rows } = await tx.query<{ id: string; name: string }>(
      'SELECT id, name FROM couriers WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
      [tx.tenantId, ids],
    );
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /**
   * Nome e regra de pagamento dos entregadores, para o acerto. Com `lock`, trava as linhas até
   * o fim da transação: o valor por entrega não muda no meio de um fechamento.
   */
  async payRules(
    tx: TenantTx,
    courierIds: string[],
    lock = false,
  ): Promise<Map<string, { name: string; feePerDeliveryCents: number | null }>> {
    const ids = [...new Set(courierIds)];
    if (ids.length === 0) return new Map();
    const { rows } = await tx.query<{ id: string; name: string; fee_per_delivery_cents: number | null }>(
      `SELECT id, name, fee_per_delivery_cents FROM couriers
        WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ${lock ? 'FOR UPDATE' : ''}`,
      [tx.tenantId, ids],
    );
    return new Map(rows.map((row) => [row.id, { name: row.name, feePerDeliveryCents: row.fee_per_delivery_cents }]));
  }

  async savePosition(tenantId: string, courierId: string, input: CourierPositionInput): Promise<void> {
    const position: CourierPosition = {
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy ?? null,
      recordedAt: new Date().toISOString(),
    };
    await this.redis.set(
      positionKey(tenantId, courierId),
      JSON.stringify(position),
      'EX',
      COURIER_POSITION_MAX_AGE_SECONDS,
    );
  }

  /** Última posição, se for recente. Sem Redis, simplesmente não há posição: o pedido segue normal. */
  async lastPosition(tenantId: string, courierId: string): Promise<CourierPosition | null> {
    try {
      const raw = await this.redis.get(positionKey(tenantId, courierId));
      return raw ? (JSON.parse(raw) as CourierPosition) : null;
    } catch (error) {
      this.logger.warn({ err: error }, 'posição do entregador indisponível');
      return null;
    }
  }

  async clearPosition(tenantId: string, courierId: string): Promise<void> {
    await this.redis.del(positionKey(tenantId, courierId)).catch(() => undefined);
  }
}

function positionKey(tenantId: string, courierId: string): string {
  return `courier-pos:${tenantId}:${courierId}`;
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function courierNotFound(): NotFoundException {
  return new NotFoundException({ error: 'courier_not_found' });
}

function phoneTaken(error: unknown): unknown {
  const { code, constraint } = error as { code?: string; constraint?: string };
  return code === '23505' && constraint === 'couriers_tenant_id_phone_key'
    ? new ConflictException({ error: 'courier_phone_taken' })
    : error;
}
