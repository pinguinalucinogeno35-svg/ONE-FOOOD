import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { REDIS_QUEUE, RELAY_POOL } from '../../platform/tokens.js';

export const EVENTS_QUEUE = 'events';

/** Tempo que um evento publicado pode ficar sem conclusão antes de voltar para a fila. */
const REQUEUE_AFTER_SECONDS = 300;
/** Depois disso o evento para de ser reenfileirado e passa a exigir atenção humana. */
const MAX_PUBLISH_ATTEMPTS = 10;

export interface EventJob {
  outboxId: string;
  tenantId: string;
  topic: string;
  payload: unknown;
}

/**
 * Leva os eventos do outbox (Postgres) para a fila (Redis).
 *
 * O Postgres é a fonte da verdade. O Redis replica de forma assíncrona e pode perder
 * tarefas num failover, por isso a reconciliação reenfileira tudo que foi publicado
 * e não teve conclusão registrada.
 */
@Injectable()
export class OutboxRelay implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly queue: Queue<EventJob>;
  private running = false;
  private loop: Promise<void> | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(RELAY_POOL) private readonly pool: Pool,
    @Inject(REDIS_QUEUE) redis: Redis,
  ) {
    this.queue = new Queue<EventJob>(EVENTS_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 3_600, count: 10_000 },
        removeOnFail: { count: 5_000 },
      },
    });
  }

  /** Publica um lote. Devolve quantos eventos saíram. */
  async publishPending(limit = 200): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // SKIP LOCKED: vários relays podem rodar em paralelo sem publicar o mesmo evento.
      const { rows } = await client.query<{
        id: string;
        tenant_id: string;
        topic: string;
        payload: unknown;
        attempts: number;
      }>(
        `SELECT id, tenant_id, topic, payload, attempts
           FROM outbox
          WHERE published_at IS NULL
          ORDER BY id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      if (rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }

      await this.queue.addBulk(
        rows.map((row) => ({
          name: row.topic,
          data: { outboxId: row.id, tenantId: row.tenant_id, topic: row.topic, payload: row.payload },
          // Se o processo cair entre publicar e gravar, a nova tentativa usa o mesmo id e a
          // fila ignora a duplicata. Um reenvio da reconciliação muda o sufixo e entra de novo.
          opts: { jobId: `outbox-${row.id}-${row.attempts}` },
        })),
      );
      await client.query(
        'UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::bigint[])',
        [rows.map((row) => row.id)],
      );
      await client.query('COMMIT');
      return rows.length;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markProcessed(outboxId: string): Promise<void> {
    await this.pool.query('UPDATE outbox SET processed_at = now() WHERE id = $1 AND processed_at IS NULL', [outboxId]);
  }

  /** Devolve para a fila o que foi publicado e nunca concluído. */
  async reconcile(olderThanSeconds = REQUEUE_AFTER_SECONDS): Promise<{ requeued: number; stuck: number }> {
    const requeued = await this.pool.query(
      `UPDATE outbox
          SET published_at = NULL
        WHERE processed_at IS NULL
          AND published_at < now() - make_interval(secs => $1)
          AND attempts < $2`,
      [olderThanSeconds, MAX_PUBLISH_ATTEMPTS],
    );
    const stuck = await this.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM outbox WHERE processed_at IS NULL AND attempts >= $1',
      [MAX_PUBLISH_ATTEMPTS],
    );
    const result = { requeued: requeued.rowCount ?? 0, stuck: Number(stuck.rows[0]?.count ?? 0) };
    if (result.requeued > 0) this.logger.warn({ ...result }, 'eventos reenfileirados pela reconciliação');
    if (result.stuck > 0) this.logger.error({ ...result }, 'eventos parados no outbox: exigem intervenção');
    return result;
  }

  start(options: { idleDelayMs?: number; reconcileEveryMs?: number } = {}): void {
    if (this.running) return;
    this.running = true;
    const idleDelayMs = options.idleDelayMs ?? 200;

    this.loop = (async () => {
      while (this.running) {
        try {
          const published = await this.publishPending();
          // Lote cheio: há mais esperando, continua sem pausa.
          if (published < 200) await sleep(idleDelayMs);
        } catch (error) {
          this.logger.error({ err: error }, 'falha ao publicar eventos do outbox');
          await sleep(1_000);
        }
      }
    })();

    this.reconcileTimer = setInterval(() => {
      this.reconcile().catch((error) => this.logger.error({ err: error }, 'falha na reconciliação do outbox'));
    }, options.reconcileEveryMs ?? 60_000);
    this.reconcileTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    await this.loop;
    await this.queue.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
