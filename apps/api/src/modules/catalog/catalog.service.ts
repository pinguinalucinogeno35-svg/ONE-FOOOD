import { Inject, Injectable } from '@nestjs/common';
import type { MenuCategoryView, MenuOptionGroupView, MenuProductView, MenuView } from '@onefood/shared';
import { TenantDb, type TenantTx } from '../../platform/db/tenant-db.js';

export interface PricedOption {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  priceDeltaCents: number;
}

export interface PricedOptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
}

export interface PricedProduct {
  id: string;
  name: string;
  priceCents: number;
  groups: PricedOptionGroup[];
  options: Map<string, PricedOption>;
}

/**
 * Dono das tabelas do cardápio. Outros módulos nunca leem essas tabelas direto:
 * pedem o que precisam por aqui.
 */
@Injectable()
export class CatalogService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  async getMenu(tenantId: string, slug: string): Promise<MenuView> {
    return this.db.withTenant(tenantId, async (tx) => {
      // Uma consulta por vez: a conexão é uma só e a transação é curta.
      const store = await tx.query<{ name: string; delivery_fee_cents: number }>(
        'SELECT name, delivery_fee_cents FROM tenants WHERE id = $1',
        [tenantId],
      );
      const categories = await tx.query<{ id: string; name: string }>(
        'SELECT id, name FROM menu_categories WHERE tenant_id = $1 AND active ORDER BY position, name',
        [tenantId],
      );
      const products = await tx.query<{
        id: string;
        category_id: string;
        name: string;
        description: string | null;
        price_cents: number;
      }>(
        `SELECT id, category_id, name, description, price_cents
           FROM products WHERE tenant_id = $1 AND active ORDER BY position, name`,
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
      const options = await tx.query<{ id: string; group_id: string; name: string; price_delta_cents: number }>(
        `SELECT id, group_id, name, price_delta_cents
           FROM product_options WHERE tenant_id = $1 AND active ORDER BY position, name`,
        [tenantId],
      );

      const groupsById = new Map<string, MenuOptionGroupView>();
      const groupsByProduct = new Map<string, MenuOptionGroupView[]>();
      for (const row of groups.rows) {
        const group: MenuOptionGroupView = {
          id: row.id,
          name: row.name,
          minSelect: row.min_select,
          maxSelect: row.max_select,
          options: [],
        };
        groupsById.set(row.id, group);
        pushTo(groupsByProduct, row.product_id, group);
      }
      for (const row of options.rows) {
        groupsById.get(row.group_id)?.options.push({
          id: row.id,
          name: row.name,
          priceDeltaCents: row.price_delta_cents,
        });
      }

      const productsByCategory = new Map<string, MenuProductView[]>();
      for (const row of products.rows) {
        pushTo(productsByCategory, row.category_id, {
          id: row.id,
          name: row.name,
          description: row.description,
          priceCents: row.price_cents,
          optionGroups: groupsByProduct.get(row.id) ?? [],
        });
      }

      const menuCategories: MenuCategoryView[] = categories.rows
        .map((row) => ({ id: row.id, name: row.name, products: productsByCategory.get(row.id) ?? [] }))
        .filter((category) => category.products.length > 0);

      return {
        store: { slug, name: store.rows[0]?.name ?? '', deliveryFeeCents: store.rows[0]?.delivery_fee_cents ?? 0 },
        categories: menuCategories,
      };
    });
  }

  /**
   * Preços e regras de opções dos produtos pedidos, lidos na transação do pedido.
   * Produtos inativos ou de outro tenant simplesmente não aparecem no resultado.
   */
  async getProductsForPricing(tx: TenantTx, productIds: string[]): Promise<Map<string, PricedProduct>> {
    const ids = [...new Set(productIds)];
    const products = await tx.query<{ id: string; name: string; price_cents: number }>(
      'SELECT id, name, price_cents FROM products WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND active',
      [tx.tenantId, ids],
    );
    const groups = await tx.query<{
      id: string;
      product_id: string;
      name: string;
      min_select: number;
      max_select: number;
    }>(
      `SELECT id, product_id, name, min_select, max_select
         FROM product_option_groups WHERE tenant_id = $1 AND product_id = ANY($2::uuid[])`,
      [tx.tenantId, ids],
    );
    const options = await tx.query<{ id: string; group_id: string; name: string; price_delta_cents: number }>(
      `SELECT id, group_id, name, price_delta_cents
         FROM product_options WHERE tenant_id = $1 AND group_id = ANY($2::uuid[]) AND active`,
      [tx.tenantId, groups.rows.map((row) => row.id)],
    );

    const result = new Map<string, PricedProduct>();
    for (const row of products.rows) {
      result.set(row.id, { id: row.id, name: row.name, priceCents: row.price_cents, groups: [], options: new Map() });
    }
    const productOfGroup = new Map<string, { product: PricedProduct; group: PricedOptionGroup }>();
    for (const row of groups.rows) {
      const product = result.get(row.product_id);
      if (!product) continue;
      const group = { id: row.id, name: row.name, minSelect: row.min_select, maxSelect: row.max_select };
      product.groups.push(group);
      productOfGroup.set(row.id, { product, group });
    }
    for (const row of options.rows) {
      const owner = productOfGroup.get(row.group_id);
      if (!owner) continue;
      owner.product.options.set(row.id, {
        id: row.id,
        groupId: row.group_id,
        groupName: owner.group.name,
        name: row.name,
        priceDeltaCents: row.price_delta_cents,
      });
    }
    return result;
  }
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
