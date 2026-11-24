-- Idempotência e outbox.

-- Chaves de idempotência ficam em tabela própria, sem particionamento: índice único em
-- tabela particionada exige a coluna de partição, o que quebraria a garantia.
CREATE TABLE idempotency_keys (
  tenant_id    uuid        NOT NULL REFERENCES tenants (id),
  scope        text        NOT NULL,
  key          text        NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  request_hash text        NOT NULL,
  resource_id  uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, key)
);
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idempotency_keys TO onefood_app
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT ON idempotency_keys TO onefood_app;

-- Outbox: o evento é gravado na mesma transação do pedido. O relay publica na fila
-- (published_at), o worker confirma a conclusão (processed_at) e a reconciliação
-- reenfileira o que foi publicado e nunca concluído, porque o Redis pode perder
-- tarefas num failover.
CREATE TABLE outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid        NOT NULL REFERENCES tenants (id),
  topic        text        NOT NULL,
  payload      jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  processed_at timestamptz,
  attempts     integer     NOT NULL DEFAULT 0
);
-- Estes dois índices não começam por tenant_id de propósito: o relay varre todos os tenants.
CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;
CREATE INDEX outbox_unprocessed ON outbox (published_at) WHERE processed_at IS NULL;

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
-- A aplicação só insere, e só para o próprio tenant.
CREATE POLICY tenant_insert ON outbox FOR INSERT TO onefood_app
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT INSERT ON outbox TO onefood_app;
-- O relay lê e marca eventos de todos os tenants, e não tem acesso a mais nenhuma tabela.
CREATE POLICY relay_all ON outbox TO onefood_relay USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON outbox TO onefood_relay;
