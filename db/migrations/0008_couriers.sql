-- Entregadores próprios do restaurante.
--
-- O entregador não tem conta nem senha: entra por um link pessoal com um token. Só o hash
-- do token fica no banco, e o restaurante pode trocar o link a qualquer momento.

CREATE TABLE couriers (
  tenant_id         uuid NOT NULL REFERENCES tenants (id),
  id                uuid NOT NULL,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  phone             text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{9,14}$'),
  active            boolean NOT NULL DEFAULT true,
  access_token_hash text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, phone),
  CONSTRAINT couriers_access_token_hash_key UNIQUE (access_token_hash)
);

ALTER TABLE couriers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON couriers TO onefood_app
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON couriers TO onefood_app;

-- O link do entregador chega sem contexto de tenant: esta função descobre de quem é o token.
-- Entregador desligado ou loja suspensa não entram.
CREATE FUNCTION app.resolve_courier(p_token_hash text)
  RETURNS TABLE (tenant_id uuid, courier_id uuid, courier_name text, store_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT c.tenant_id, c.id, c.name, t.name
      FROM couriers c
      JOIN tenants t ON t.id = c.tenant_id AND t.status = 'active'
     WHERE c.access_token_hash = p_token_hash AND c.active
  $$;
REVOKE ALL ON FUNCTION app.resolve_courier(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_courier(text) TO onefood_app;

-- Quem leva o pedido. Coluna nova e anulável: não reescreve a tabela particionada.
ALTER TABLE orders ADD COLUMN courier_id uuid;
ALTER TABLE orders ADD CONSTRAINT orders_courier_fk
  FOREIGN KEY (tenant_id, courier_id) REFERENCES couriers (tenant_id, id);
-- Entregas em andamento de um entregador.
CREATE INDEX orders_open_by_courier ON orders (tenant_id, courier_id, created_at)
  WHERE courier_id IS NOT NULL AND status NOT IN ('completed', 'cancelled');
