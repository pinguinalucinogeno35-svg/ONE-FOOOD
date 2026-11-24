import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  AdminCategoryView,
  AdminMenuView,
  AdminOptionGroupView,
  AdminProductView,
  CreateCategoryInput,
  CreateProductInput,
  ReplaceOptionGroupsInput,
  UpdateCategoryInput,
  UpdateProductInput,
  UpdateStoreInput,
} from '@onefood/shared';
import { TenantDb, type TenantTx } from '../../platform/db/tenant-db.js';
import { newId } from '../../platform/ids.js';

/** Colunas que o painel pode alterar, por campo do corpo. Nada fora desta lista vira SQL. */
const CATEGORY_COLUMNS = { name: 'name', position: 'position', active: 'active' } as const;
const PRODUCT_COLUMNS = {
  categoryId: 'category_id',
  name: 'name',
  description: 'description',
  priceCents: 'price_cents',
  position: 'position',
  active: 'active',
} as const;
const STORE_COLUMNS = { name: 'name', deliveryFeeCents: 'delivery_fee_cents' } as const;

/** Gestão do cardápio pelo restaurante. */
@Injectable()
export class CatalogAdminService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  async getMenu(tenantId: string, slug: string): Promise<AdminMenuView> {
    return this.db.withTenant(tenantId, async (tx) => {
      const store = await tx.query<{ name: string; delivery_fee_cents: number }>(
        'SELECT name, delivery_fee_cents FROM tenants WHERE id = $1',
        [tenantId],
      );
      const categories = await tx.query<{ id: string; name: string; position: number; active: boolean }>(
        'SELECT id, name, position, active FROM menu_categories WHERE tenant_id = $1 ORDER BY position, name',
        [tenantId],
      );
      const products = await tx.query<{
        id: string;
        category_id: string;
        name: string;
        description: string | null;
        price_cents: number;
        position: number;
        active: boolean;
      }>(
        `SELECT id, category_id, name, description, price_cents, position, active
           FROM products WHERE tenant_id = $1 ORDER BY position, name`,
        [tenantId],
      );
      const groups = await tx.query<{
        id: string;
        product_id: string;
        name: string;
        min_select: number;
        max_select: number;
      }>(
        `SELECT id, product_id, name, min_select, max_select
           FROM product_option_groups WHERE tenant_id = $1 ORDER BY position, name`,
        [tenantId],
      );
      const options = await tx.query<{
        id: string;
        group_id: string;
        name: string;
        price_delta_cents: number;
        active: boolean;
      }>(
        `SELECT id, group_id, name, price_delta_cents, active
           FROM product_options WHERE tenant_id = $1 ORDER BY position, name`,
        [tenantId],
      );

      const groupsById = new Map<string, AdminOptionGroupView>();
      const groupsByProduct = new Map<string, AdminOptionGroupView[]>();
      for (const row of groups.rows) {
        const group = { id: row.id, name: row.name, minSelect: row.min_select, maxSelect: row.max_select, options: [] };
        groupsById.set(row.id, group);
        groupsByProduct.set(row.product_id, [...(groupsByProduct.get(row.product_id) ?? []), group]);
      }
      for (const row of options.rows) {
        groupsById
          .get(row.group_id)
          ?.options.push({ id: row.id, name: row.name, priceDeltaCents: row.price_delta_cents, active: row.active });
      }
      const productsByCategory = new Map<string, AdminProductView[]>();
      for (const row of products.rows) {
        const product: AdminProductView = {
          id: row.id,
          categoryId: row.category_id,
          name: row.name,
          description: row.description,
          priceCents: row.price_cents,
          position: row.position,
          active: row.active,
          optionGroups: groupsByProduct.get(row.id) ?? [],
        };
        productsByCategory.set(row.category_id, [...(productsByCategory.get(row.category_id) ?? []), product]);
      }
      const menuCategories: AdminCategoryView[] = categories.rows.map((row) => ({
        id: row.id,
        name: row.name,
        position: row.position,
        active: row.active,
        products: productsByCategory.get(row.id) ?? [],
      }));

      return {
        store: { slug, name: store.rows[0]?.name ?? '', deliveryFeeCents: store.rows[0]?.delivery_fee_cents ?? 0 },
        categories: menuCategories,
      };
    });
  }

  async updateStore(tenantId: string, patch: UpdateStoreInput): Promise<void> {
    await this.db.withTenant(tenantId, async (tx) => {
      await applyPatch(tx, 'tenants', STORE_COLUMNS, patch, 'id = $1', [tenantId]);
    });
  }

  async createCategory(tenantId: string, input: CreateCategoryInput): Promise<{ id: string }> {
    const id = newId();
    await this.db.withTenant(tenantId, (tx) =>
      tx.query('INSERT INTO menu_categories (tenant_id, id, name, position) VALUES ($1, $2, $3, $4)', [
        tenantId,
        id,
        input.name,
        input.position,
      ]),
    );
    return { id };
  }

  async updateCategory(tenantId: string, categoryId: string, patch: UpdateCategoryInput): Promise<void> {
    await this.db.withTenant(tenantId, async (tx) => {
      const updated = await applyPatch(tx, 'menu_categories', CATEGORY_COLUMNS, patch, 'tenant_id = $1 AND id = $2', [
        tenantId,
        categoryId,
      ]);
      if (updated === 0) throw new NotFoundException({ error: 'category_not_found' });
    });
  }

  async createProduct(tenantId: string, input: CreateProductInput): Promise<{ id: string }> {
    const id = newId();
    await this.db.withTenant(tenantId, async (tx) => {
      await requireCategory(tx, input.categoryId);
      await tx.query(
        `INSERT INTO products (tenant_id, id, category_id, name, description, price_cents, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, id, input.categoryId, input.name, input.description, input.priceCents, input.position],
      );
    });
    return { id };
  }

  async updateProduct(tenantId: string, productId: string, patch: UpdateProductInput): Promise<void> {
    await this.db.withTenant(tenantId, async (tx) => {
      if (patch.categoryId !== undefined) await requireCategory(tx, patch.categoryId);
      const updated = await applyPatch(tx, 'products', PRODUCT_COLUMNS, patch, 'tenant_id = $1 AND id = $2', [
        tenantId,
        productId,
      ]);
      if (updated === 0) throw new NotFoundException({ error: 'product_not_found' });
    });
  }

  /** Troca todos os grupos e opções do produto pelo conjunto enviado, em uma transação. */
  async replaceOptionGroups(tenantId: string, productId: string, input: ReplaceOptionGroupsInput): Promise<void> {
    await this.db.withTenant(tenantId, async (tx) => {
      // FOR UPDATE: duas edições simultâneas do mesmo produto não se misturam.
      const product = await tx.query('SELECT 1 FROM products WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [
        tenantId,
        productId,
      ]);
      if (product.rowCount === 0) throw new NotFoundException({ error: 'product_not_found' });

      await tx.query(
        `DELETE FROM product_options
          WHERE tenant_id = $1
            AND group_id IN (SELECT id FROM product_option_groups WHERE tenant_id = $1 AND product_id = $2)`,
        [tenantId, productId],
      );
      await tx.query('DELETE FROM product_option_groups WHERE tenant_id = $1 AND product_id = $2', [
        tenantId,
        productId,
      ]);

      const groups = input.groups.map((group, index) => ({ ...group, id: newId(), position: index }));
      if (groups.length === 0) return;
      await tx.query(
        `INSERT INTO product_option_groups (tenant_id, id, product_id, name, min_select, max_select, position)
         SELECT $1, g.id, $2, g.name, g.min_select, g.max_select, g.position
           FROM jsonb_to_recordset($3::jsonb)
             AS g(id uuid, name text, min_select integer, max_select integer, position integer)`,
        [
          tenantId,
          productId,
          JSON.stringify(
            groups.map((group) => ({
              id: group.id,
              name: group.name,
              min_select: group.minSelect,
              max_select: group.maxSelect,
              position: group.position,
            })),
          ),
        ],
      );
      await tx.query(
        `INSERT INTO product_options (tenant_id, id, group_id, name, price_delta_cents, position, active)
         SELECT $1, o.id, o.group_id, o.name, o.price_delta_cents, o.position, o.active
           FROM jsonb_to_recordset($2::jsonb)
             AS o(id uuid, group_id uuid, name text, price_delta_cents integer, position integer, active boolean)`,
        [
          tenantId,
          JSON.stringify(
            groups.flatMap((group) =>
              group.options.map((option, index) => ({
                id: newId(),
                group_id: group.id,
                name: option.name,
                price_delta_cents: option.priceDeltaCents,
                position: index,
                active: option.active,
              })),
            ),
          ),
        ],
      );
    });
  }
}

async function requireCategory(tx: TenantTx, categoryId: string): Promise<void> {
  const found = await tx.query('SELECT 1 FROM menu_categories WHERE tenant_id = $1 AND id = $2', [
    tx.tenantId,
    categoryId,
  ]);
  if (found.rowCount === 0) throw new UnprocessableEntityException({ error: 'category_not_found' });
}

/** UPDATE só com os campos enviados. Os nomes de coluna vêm sempre do mapa fixo, nunca do corpo. */
async function applyPatch<K extends string>(
  tx: TenantTx,
  table: 'tenants' | 'menu_categories' | 'products',
  columns: Record<K, string>,
  patch: Partial<Record<K, unknown>>,
  where: string,
  whereValues: unknown[],
): Promise<number> {
  const sets: string[] = [];
  const values = [...whereValues];
  for (const [field, column] of Object.entries(columns) as Array<[K, string]>) {
    if (patch[field] === undefined) continue;
    values.push(patch[field]);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return 0;
  const result = await tx.query(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = now() WHERE ${where}`, values);
  return result.rowCount ?? 0;
}
