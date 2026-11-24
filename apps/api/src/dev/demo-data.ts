import type { TenantTx } from '../platform/db/tenant-db.js';
import { newId } from '../platform/ids.js';

export interface DemoMenu {
  margherita: string;
  calabresa: string;
  refrigerante: string;
  inativo: string;
  tamanhoMedia: string;
  tamanhoGrande: string;
  bordaRecheada: string;
  bacon: string;
  calabresaGrande: string;
}

/** Cardápio de exemplo, usado pelo seed de desenvolvimento e pelos testes. */
export async function insertDemoMenu(tx: TenantTx): Promise<DemoMenu> {
  const t = tx.tenantId;
  const pizzas = newId();
  const bebidas = newId();
  await tx.query(
    `INSERT INTO menu_categories (tenant_id, id, name, position) VALUES ($1, $2, 'Pizzas', 1), ($1, $3, 'Bebidas', 2)`,
    [t, pizzas, bebidas],
  );

  const ids: DemoMenu = {
    margherita: newId(),
    calabresa: newId(),
    refrigerante: newId(),
    inativo: newId(),
    tamanhoMedia: newId(),
    tamanhoGrande: newId(),
    bordaRecheada: newId(),
    bacon: newId(),
    calabresaGrande: newId(),
  };
  await tx.query(
    `INSERT INTO products (tenant_id, id, category_id, name, description, price_cents, position, active) VALUES
       ($1, $2, $6, 'Pizza Margherita', 'Molho de tomate, muçarela e manjericão', 4500, 1, true),
       ($1, $3, $6, 'Pizza Calabresa', 'Calabresa fatiada e cebola', 4800, 2, true),
       ($1, $4, $7, 'Refrigerante lata', NULL, 700, 1, true),
       ($1, $5, $7, 'Suco da casa', 'Fora do cardápio', 900, 2, false)`,
    [t, ids.margherita, ids.calabresa, ids.refrigerante, ids.inativo, pizzas, bebidas],
  );

  const tamanho = newId();
  const adicionais = newId();
  const tamanhoCalabresa = newId();
  await tx.query(
    `INSERT INTO product_option_groups (tenant_id, id, product_id, name, min_select, max_select, position) VALUES
       ($1, $2, $5, 'Tamanho', 1, 1, 1),
       ($1, $3, $5, 'Adicionais', 0, 2, 2),
       ($1, $4, $6, 'Tamanho', 1, 1, 1)`,
    [t, tamanho, adicionais, tamanhoCalabresa, ids.margherita, ids.calabresa],
  );
  await tx.query(
    `INSERT INTO product_options (tenant_id, id, group_id, name, price_delta_cents, position) VALUES
       ($1, $2, $7, 'Média', 0, 1),
       ($1, $3, $7, 'Grande', 1200, 2),
       ($1, $4, $8, 'Borda recheada', 800, 1),
       ($1, $5, $8, 'Bacon', 600, 2),
       ($1, $6, $9, 'Grande', 1200, 1)`,
    [
      t,
      ids.tamanhoMedia,
      ids.tamanhoGrande,
      ids.bordaRecheada,
      ids.bacon,
      ids.calabresaGrande,
      tamanho,
      adicionais,
      tamanhoCalabresa,
    ],
  );
  await tx.query('UPDATE tenants SET delivery_fee_cents = 600 WHERE id = $1', [t]);
  return ids;
}
