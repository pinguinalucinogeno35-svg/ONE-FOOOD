-- Cupons e avaliação pós-pedido.

CREATE TABLE coupons (
  tenant_id          uuid    NOT NULL REFERENCES tenants (id),
  id                 uuid    NOT NULL,
  code               text    NOT NULL CHECK (code ~ '^[A-Z0-9]{3,20}$'),
  -- percent: value é a porcentagem (1 a 100). fixed: value é o desconto em centavos.
  kind               text    NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value              integer NOT NULL CHECK (value > 0),
  min_order_cents    integer NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  -- Teto do desconto, para cupom percentual.
  max_discount_cents integer CHECK (max_discount_cents > 0),
  starts_at          timestamptz,
  ends_at            timestamptz,
  max_redemptions    integer CHECK (max_redemptions > 0),
  once_per_customer  boolean NOT NULL DEFAULT true,
  active             boolean NOT NULL DEFAULT true,
  -- Usos válidos até agora. Pedido cancelado devolve o uso.
  redemptions        integer NOT NULL DEFAULT 0 CHECK (redemptions >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (kind <> 'percent' OR value <= 100),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

-- Um cupom por pedido. A linha fica mesmo se o pedido for cancelado (voided_at),
-- para o histórico não perder o que aconteceu.
CREATE TABLE coupon_redemptions (
  tenant_id        uuid        NOT NULL REFERENCES tenants (id),
  order_id         uuid        NOT NULL,
  order_created_at timestamptz NOT NULL,
  coupon_id        uuid        NOT NULL,
  customer_id      uuid        NOT NULL,
  discount_cents   integer     NOT NULL CHECK (discount_cents > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  voided_at        timestamptz,
  PRIMARY KEY (tenant_id, order_id),
  FOREIGN KEY (tenant_id, coupon_id) REFERENCES coupons (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id),
  -- Conferida no COMMIT: o uso do cupom é registrado antes de a linha do pedido existir,
  -- porque o pedido já nasce com o desconto.
  FOREIGN KEY (tenant_id, order_id, order_created_at) REFERENCES orders (tenant_id, id, created_at)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX coupon_redemptions_by_customer ON coupon_redemptions (tenant_id, coupon_id, customer_id)
  WHERE voided_at IS NULL;

-- O pedido guarda o código usado, para o painel e o cliente verem de onde veio o desconto.
ALTER TABLE orders ADD COLUMN coupon_code text;

-- Uma avaliação por pedido, só depois de concluído. item_ratings guarda a nota de cada prato
-- com o nome do produto na hora da venda.
CREATE TABLE order_reviews (
  tenant_id        uuid        NOT NULL REFERENCES tenants (id),
  order_id         uuid        NOT NULL,
  order_created_at timestamptz NOT NULL,
  rating           smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment          text        CHECK (length(comment) <= 1000),
  item_ratings     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, order_id),
  FOREIGN KEY (tenant_id, order_id, order_created_at) REFERENCES orders (tenant_id, id, created_at)
);
CREATE INDEX order_reviews_recent ON order_reviews (tenant_id, created_at DESC);

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['coupons', 'coupon_redemptions', 'order_reviews'] LOOP
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

GRANT SELECT, INSERT, UPDATE ON coupons TO onefood_app;
GRANT SELECT, INSERT, UPDATE ON coupon_redemptions TO onefood_app;
-- Avaliação não se edita nem se apaga.
GRANT SELECT, INSERT ON order_reviews TO onefood_app;
