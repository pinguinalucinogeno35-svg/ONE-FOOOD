-- Pedidos, itens e eventos, particionados por mês.
--
-- O id do pedido é um UUID versão 7 gerado pela aplicação e created_at é o instante
-- embutido nele (garantido por CHECK). Assim, quem tem o id sabe a partição: buscar um
-- pedido pelo id toca uma única partição, sem varrer todos os meses.

CREATE TABLE orders (
  tenant_id          uuid        NOT NULL REFERENCES tenants (id),
  id                 uuid        NOT NULL,
  created_at         timestamptz NOT NULL,
  number             bigint      NOT NULL,
  customer_id        uuid        NOT NULL,
  channel            text        NOT NULL CHECK (channel IN ('web', 'whatsapp', 'pos')),
  fulfillment        text        NOT NULL CHECK (fulfillment IN ('delivery', 'pickup', 'dine_in')),
  payment_method     text        NOT NULL CHECK (payment_method IN ('pix', 'card_on_delivery', 'cash')),
  status             text        NOT NULL DEFAULT 'pending' CHECK (status IN (
                       'pending', 'confirmed', 'preparing', 'ready',
                       'out_for_delivery', 'completed', 'cancelled')),
  subtotal_cents     integer     NOT NULL CHECK (subtotal_cents >= 0),
  delivery_fee_cents integer     NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  discount_cents     integer     NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents        integer     NOT NULL CHECK (total_cents >= 0),
  delivery_address   jsonb,
  notes              text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id, created_at),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id),
  CHECK (created_at = app.uuid_v7_time(id)),
  CHECK (total_cents = subtotal_cents + delivery_fee_cents - discount_cents),
  CHECK (fulfillment <> 'delivery' OR delivery_address IS NOT NULL)
) PARTITION BY RANGE (created_at);

-- Histórico do restaurante, do mais novo para o mais antigo.
CREATE INDEX orders_by_tenant_created ON orders (tenant_id, created_at DESC);
-- Painel e cozinha: só os pedidos em aberto.
CREATE INDEX orders_open_by_tenant ON orders (tenant_id, status, created_at)
  WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX orders_by_customer ON orders (tenant_id, customer_id, created_at DESC);

-- Itens guardam nome, preço e opções como estavam na hora da venda:
-- mudar o cardápio depois não reescreve o passado.
CREATE TABLE order_items (
  tenant_id        uuid        NOT NULL REFERENCES tenants (id),
  order_id         uuid        NOT NULL,
  order_created_at timestamptz NOT NULL,
  line_no          integer     NOT NULL CHECK (line_no >= 1),
  product_id       uuid        NOT NULL,
  product_name     text        NOT NULL,
  quantity         integer     NOT NULL CHECK (quantity >= 1),
  unit_price_cents integer     NOT NULL CHECK (unit_price_cents >= 0),
  options          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  total_cents      integer     NOT NULL CHECK (total_cents >= 0),
  notes            text,
  PRIMARY KEY (tenant_id, order_id, line_no, order_created_at),
  FOREIGN KEY (tenant_id, order_id, order_created_at) REFERENCES orders (tenant_id, id, created_at),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id)
) PARTITION BY RANGE (order_created_at);

-- Livro de eventos do pedido: só inserção.
CREATE TABLE order_events (
  tenant_id        uuid        NOT NULL REFERENCES tenants (id),
  id               uuid        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  order_id         uuid        NOT NULL,
  order_created_at timestamptz NOT NULL,
  type             text        NOT NULL,
  payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, id, created_at),
  FOREIGN KEY (tenant_id, order_id, order_created_at) REFERENCES orders (tenant_id, id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX order_events_by_order ON order_events (tenant_id, order_id, created_at);

-- Rede de segurança: um pedido nunca falha por falta de partição. Linhas aqui indicam que
-- app.ensure_partitions() não rodou e devem disparar alerta.
CREATE TABLE orders_default       PARTITION OF orders       DEFAULT;
CREATE TABLE order_items_default  PARTITION OF order_items  DEFAULT;
CREATE TABLE order_events_default PARTITION OF order_events DEFAULT;

INSERT INTO app.partitioned_tables (table_name) VALUES ('orders'), ('order_items'), ('order_events');
SELECT app.ensure_partitions(3);

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['orders', 'order_items', 'order_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO onefood_app
         USING (tenant_id = app.current_tenant_id())
         WITH CHECK (tenant_id = app.current_tenant_id())',
      v_table
    );
  END LOOP;
END
$$;

-- O acesso é sempre pela tabela mãe; as partições não recebem GRANT.
GRANT SELECT, INSERT, UPDATE ON orders TO onefood_app;
GRANT SELECT, INSERT ON order_items TO onefood_app;
GRANT SELECT, INSERT ON order_events TO onefood_app;
