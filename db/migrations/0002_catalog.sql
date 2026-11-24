-- Catálogo e clientes. Toda tabela tem tenant_id, toda chave e todo índice começam por ele,
-- e as chaves estrangeiras são compostas: uma linha nunca aponta para outro tenant.

CREATE TABLE menu_categories (
  tenant_id  uuid    NOT NULL REFERENCES tenants (id),
  id         uuid    NOT NULL,
  name       text    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  position   integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE products (
  tenant_id   uuid    NOT NULL REFERENCES tenants (id),
  id          uuid    NOT NULL,
  category_id uuid    NOT NULL,
  name        text    NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description text,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  position    integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES menu_categories (tenant_id, id)
);
CREATE INDEX products_by_category ON products (tenant_id, category_id, position);

-- Grupos de opções de um produto: tamanho, borda, adicionais.
CREATE TABLE product_option_groups (
  tenant_id  uuid    NOT NULL REFERENCES tenants (id),
  id         uuid    NOT NULL,
  product_id uuid    NOT NULL,
  name       text    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  min_select integer NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select integer NOT NULL DEFAULT 1 CHECK (max_select >= 1),
  position   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id),
  CHECK (min_select <= max_select)
);
CREATE INDEX product_option_groups_by_product ON product_option_groups (tenant_id, product_id, position);

CREATE TABLE product_options (
  tenant_id         uuid    NOT NULL REFERENCES tenants (id),
  id                uuid    NOT NULL,
  group_id          uuid    NOT NULL,
  name              text    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  price_delta_cents integer NOT NULL DEFAULT 0 CHECK (price_delta_cents >= 0),
  position          integer NOT NULL DEFAULT 0,
  active            boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES product_option_groups (tenant_id, id)
);
CREATE INDEX product_options_by_group ON product_options (tenant_id, group_id, position);

-- Cliente final do restaurante. Pedido sem login: a identidade é o telefone.
-- O restaurante é o controlador destes dados (LGPD); o ONE Food é operador.
CREATE TABLE customers (
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  id                  uuid NOT NULL,
  phone               text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{9,14}$'),
  name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  -- Consentimento explícito para marketing no WhatsApp. NULL = não consentiu.
  marketing_opt_in_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, phone)
);

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'menu_categories', 'products', 'product_option_groups', 'product_options', 'customers'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO onefood_app
         USING (tenant_id = app.current_tenant_id())
         WITH CHECK (tenant_id = app.current_tenant_id())',
      v_table
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO onefood_app', v_table);
  END LOOP;
END
$$;
