-- Fundação: papéis, contexto de tenant, tenants e utilitários de particionamento.
--
-- Papéis:
--   dono (quem roda as migrações)  dono das tabelas; usado só em migração e manutenção
--   onefood_app                    API e workers; sujeito a Row Level Security
--   onefood_relay                  relay do outbox; só enxerga a tabela outbox

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onefood_app') THEN
    CREATE ROLE onefood_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onefood_relay') THEN
    CREATE ROLE onefood_relay NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA app;
GRANT USAGE ON SCHEMA app TO onefood_app, onefood_relay;

-- O tenant da transação. A aplicação define com set_config('app.tenant_id', $1, true),
-- o equivalente parametrizável de SET LOCAL: vale só até o fim da transação, o que é
-- obrigatório atrás do PgBouncer em modo transação.
-- Depois de um SET LOCAL a variável volta como texto vazio, não como NULL; por isso o NULLIF.
CREATE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- Instante embutido em um UUID versão 7 (primeiros 48 bits = milissegundos Unix).
CREATE FUNCTION app.uuid_v7_time(p_id uuid) RETURNS timestamptz
  LANGUAGE sql IMMUTABLE STRICT
  AS $$
    SELECT to_timestamp(
      ('x' || substr(replace(p_id::text, '-', ''), 1, 12))::bit(48)::bigint / 1000.0
    )
  $$;

CREATE TABLE tenants (
  id                 uuid PRIMARY KEY,
  slug               text NOT NULL UNIQUE
                     CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 60),
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  timezone           text NOT NULL DEFAULT 'America/Sao_Paulo',
  delivery_fee_cents integer NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants TO onefood_app
  USING (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());
GRANT SELECT, UPDATE ON tenants TO onefood_app;

-- Criar um tenant e descobrir o tenant de um slug acontecem antes de existir contexto
-- de tenant, então passam por funções do dono em vez de acesso direto à tabela.
CREATE FUNCTION app.create_tenant(p_id uuid, p_slug text, p_name text) RETURNS uuid
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ INSERT INTO tenants (id, slug, name) VALUES (p_id, p_slug, p_name) RETURNING id $$;

CREATE FUNCTION app.resolve_tenant(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ SELECT id FROM tenants WHERE slug = p_slug AND status = 'active' $$;

REVOKE ALL ON FUNCTION app.create_tenant(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_tenant(uuid, text, text) TO onefood_app;
GRANT EXECUTE ON FUNCTION app.resolve_tenant(text) TO onefood_app;

-- Contadores por tenant (número do pedido exibido na cozinha, por exemplo).
CREATE TABLE tenant_sequences (
  tenant_id uuid   NOT NULL REFERENCES tenants (id),
  name      text   NOT NULL,
  value     bigint NOT NULL,
  PRIMARY KEY (tenant_id, name)
);
ALTER TABLE tenant_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_sequences TO onefood_app
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tenant_sequences TO onefood_app;

-- Particionamento mensal. Cada tabela particionada se registra aqui e
-- app.ensure_partitions() cria as partições dos próximos meses.
CREATE TABLE app.partitioned_tables (
  table_name text PRIMARY KEY
);

CREATE FUNCTION app.ensure_partitions(p_months_ahead integer DEFAULT 3) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_table   text;
  v_start   date;
  v_name    text;
  v_created integer := 0;
BEGIN
  IF p_months_ahead < 0 OR p_months_ahead > 24 THEN
    RAISE EXCEPTION 'p_months_ahead fora do intervalo: %', p_months_ahead;
  END IF;

  FOR v_table IN SELECT table_name FROM app.partitioned_tables ORDER BY table_name LOOP
    FOR i IN 0..p_months_ahead LOOP
      v_start := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i))::date;
      v_name := format('%s_y%sm%s', v_table, to_char(v_start, 'YYYY'), to_char(v_start, 'MM'));
      IF to_regclass(format('public.%I', v_name)) IS NULL THEN
        -- Limites em UTC explícito: o mês de uma partição não depende do fuso da sessão.
        EXECUTE format(
          'CREATE TABLE public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
          v_name,
          v_table,
          to_char(v_start, 'YYYY-MM-DD') || ' 00:00:00+00',
          to_char(v_start + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
        );
        v_created := v_created + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_created;
END
$$;

REVOKE ALL ON FUNCTION app.ensure_partitions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ensure_partitions(integer) TO onefood_app;
