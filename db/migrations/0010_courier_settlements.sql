-- Acerto com o entregador: o que ele tem a receber pelas entregas e o dinheiro que recebeu
-- em mãos dos clientes.

-- Quanto o entregador recebe por entrega. NULL = recebe a taxa de entrega de cada pedido.
ALTER TABLE couriers ADD COLUMN fee_per_delivery_cents integer CHECK (fee_per_delivery_cents >= 0);

-- Um acerto fechado. Os valores são a fotografia do momento do fechamento: mudar depois a
-- regra de pagamento do entregador não reescreve acertos antigos.
CREATE TABLE courier_settlements (
  tenant_id  uuid        NOT NULL REFERENCES tenants (id),
  id         uuid        NOT NULL,
  courier_id uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL REFERENCES users (id),
  deliveries integer     NOT NULL CHECK (deliveries > 0),
  -- A pagar ao entregador pelas entregas.
  fees_cents integer     NOT NULL CHECK (fees_cents >= 0),
  -- Dinheiro que o entregador recebeu dos clientes e deve repassar.
  cash_cents integer     NOT NULL CHECK (cash_cents >= 0),
  note       text        CHECK (length(note) <= 300),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, courier_id) REFERENCES couriers (tenant_id, id)
);
CREATE INDEX courier_settlements_recent ON courier_settlements (tenant_id, created_at DESC);

ALTER TABLE courier_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON courier_settlements TO onefood_app
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
-- Acerto fechado não se edita nem se apaga.
GRANT SELECT, INSERT ON courier_settlements TO onefood_app;

-- Em qual acerto a entrega entrou. NULL = ainda não acertada.
ALTER TABLE orders ADD COLUMN courier_settlement_id uuid;
ALTER TABLE orders ADD CONSTRAINT orders_courier_settlement_fk
  FOREIGN KEY (tenant_id, courier_settlement_id) REFERENCES courier_settlements (tenant_id, id);
-- Entregas concluídas esperando acerto. Sem limite de data: entrega antiga não acertada
-- continua contando.
CREATE INDEX orders_unsettled_by_courier ON orders (tenant_id, courier_id)
  WHERE courier_id IS NOT NULL AND status = 'completed' AND courier_settlement_id IS NULL;
