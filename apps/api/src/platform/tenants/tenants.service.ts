import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDb } from '../db/tenant-db.js';

const CACHE_TTL_MS = 30_000;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Traduz o slug público da loja no tenant_id que prende a transação. */
@Injectable()
export class TenantsService {
  private readonly cache = new Map<string, { tenantId: string | null; expiresAt: number }>();

  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  async resolveSlug(slug: string): Promise<string> {
    if (slug.length < 3 || slug.length > 60 || !SLUG_PATTERN.test(slug)) throw storeNotFound();

    const cached = this.cache.get(slug);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.tenantId) throw storeNotFound();
      return cached.tenantId;
    }

    const { rows } = await this.db.platformQuery<{ id: string | null }>('SELECT app.resolve_tenant($1) AS id', [slug]);
    const tenantId = rows[0]?.id ?? null;
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(slug, { tenantId, expiresAt: Date.now() + CACHE_TTL_MS });
    if (!tenantId) throw storeNotFound();
    return tenantId;
  }

  async create(input: { id: string; slug: string; name: string }): Promise<string> {
    await this.db.platformQuery('SELECT app.create_tenant($1, $2, $3)', [input.id, input.slug, input.name]);
    this.cache.delete(input.slug);
    return input.id;
  }
}

function storeNotFound(): NotFoundException {
  return new NotFoundException({ error: 'store_not_found' });
}
