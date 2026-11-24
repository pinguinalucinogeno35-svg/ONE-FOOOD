import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { APP_POOL } from '../tokens.js';

/** Limite de 5 segundos por consulta no primário: relatório pesado não roda aqui. */
const STATEMENT_TIMEOUT_MS = 5_000;

/** Conexão dentro de uma transação já presa a um tenant. */
export interface TenantTx {
  readonly tenantId: string;
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

/**
 * Única porta de acesso ao banco para código de negócio.
 *
 * Toda consulta roda dentro de uma transação que fixa o tenant com set_config(..., true),
 * o equivalente de SET LOCAL. O valor some no COMMIT ou ROLLBACK, então nada vaza para a
 * próxima requisição que reutilizar a conexão (obrigatório com PgBouncer em modo transação).
 * Sem esse contexto, o Row Level Security não devolve nenhuma linha.
 */
@Injectable()
export class TenantDb {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  async withTenant<T>(tenantId: string, work: (tx: TenantTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      // Uma ida ao banco fixa o tenant e o limite de tempo, ambos só para esta transação.
      await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('statement_timeout', $2, true)", [
        tenantId,
        String(STATEMENT_TIMEOUT_MS),
      ]);
      const result = await work(bind(client, tenantId));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Sem ROLLBACK confirmado, a conexão não volta para o pool.
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }

  /** Consultas sem tenant: só funções de plataforma (resolver slug, criar tenant, partições). */
  platformQuery<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }
}

function bind(client: PoolClient, tenantId: string): TenantTx {
  return {
    tenantId,
    query: (text, values) => client.query(text, values),
  };
}
