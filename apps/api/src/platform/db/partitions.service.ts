import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { TenantDb } from './tenant-db.js';

const EVERY_MS = 6 * 60 * 60 * 1_000;

/** Mantém criadas as partições mensais dos próximos meses. Roda no processo de workers. */
@Injectable()
export class PartitionsService implements OnApplicationShutdown {
  private readonly logger = new Logger(PartitionsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  async ensure(monthsAhead = 3): Promise<number> {
    const { rows } = await this.db.platformQuery<{ created: number }>('SELECT app.ensure_partitions($1) AS created', [
      monthsAhead,
    ]);
    const created = rows[0]?.created ?? 0;
    if (created > 0) this.logger.log({ created }, 'partições mensais criadas');
    return created;
  }

  start(): void {
    if (this.timer) return;
    const run = () => this.ensure().catch((error) => this.logger.error({ err: error }, 'falha ao criar partições'));
    void run();
    this.timer = setInterval(run, EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
