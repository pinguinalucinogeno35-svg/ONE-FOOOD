-- Pagamentos. Dados de cartão nunca passam por aqui: só a referência do provedor.

CREATE TABLE payments (
  tenant_id        uuid        NOT NULL REFERENCES tenants (id),
  id               uuid        NOT NULL,
  order_id         uuid        NOT NULL,
  order_created_at timestamptz NOT NULL,
  method           text        NOT NULL CHECK (method IN ('pix', 'card_on_delivery', 'cash')),
  status           text        NOT NULL DEFAULT 'pending' CHECK (status IN (
                     'pending', 'paid', 'failed', 'refunded', 'cancelled')),
  amount_cents     integer     NOT NULL CHECK (amount_cents >= 0),
  provider         text,
  provider_ref     text,
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id, order_created_at) REFERENCES orders (tenant_id, id, created_at),
  -- O mesmo aviso do provedor (webhook repetido) nunca vira dois pagamentos.
  UNIQUE (tenant_id, provider, provider_ref),
  CHECK ((provider IS NULL) = (provider_ref IS NULL))
);
CREATE INDEX payments_by_order ON payments (tenant_id, order_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments TO onefood_app
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON payments TO onefood_app;
