-- Identidade (usuários, sessões, vínculos com restaurantes) e permissões do painel.
--
-- users e sessions não pertencem a um tenant: uma pessoa pode trabalhar em mais de um
-- restaurante. Por isso ficam fechadas para a aplicação (RLS ligado, sem política e sem
-- GRANT) e todo acesso passa pelas funções abaixo. Um erro de SQL em código de negócio
-- não consegue listar usuários nem ler hashes de senha.

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email)
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE TABLE sessions (
  id         uuid PRIMARY KEY,
  -- Só o hash do token fica no banco: quem ler esta tabela não consegue entrar como ninguém.
  token_hash text NOT NULL UNIQUE,
  user_id    uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_by_user ON sessions (user_id);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE memberships (
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  user_id    uuid NOT NULL REFERENCES users (id),
  role       text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_by_user ON memberships (user_id);
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships TO onefood_app
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT ON memberships TO onefood_app;

-- Cadastro self-service: a conta, o restaurante e o vínculo de dono nascem juntos ou não nascem.
CREATE FUNCTION app.signup(
  p_user_id uuid, p_email text, p_name text, p_password_hash text,
  p_tenant_id uuid, p_slug text, p_store_name text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
BEGIN
  INSERT INTO users (id, email, name, password_hash) VALUES (p_user_id, p_email, p_name, p_password_hash);
  INSERT INTO tenants (id, slug, name) VALUES (p_tenant_id, p_slug, p_store_name);
  INSERT INTO memberships (tenant_id, user_id, role) VALUES (p_tenant_id, p_user_id, 'owner');
END
$$;

CREATE FUNCTION app.login_lookup(p_email text) RETURNS TABLE (user_id uuid, password_hash text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ SELECT u.id, u.password_hash FROM users u WHERE u.email = p_email $$;

CREATE FUNCTION app.create_session(p_id uuid, p_token_hash text, p_user_id uuid, p_ttl_seconds integer)
  RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    INSERT INTO sessions (id, token_hash, user_id, expires_at)
    VALUES (p_id, p_token_hash, p_user_id, now() + make_interval(secs => p_ttl_seconds))
  $$;

-- Quem é o dono da sessão e a quais restaurantes ativos ele tem acesso.
-- Uma linha por restaurante; usuário sem restaurante devolve uma linha com tenant nulo.
CREATE FUNCTION app.session_context(p_token_hash text)
  RETURNS TABLE (
    user_id uuid, email text, name text,
    tenant_id uuid, tenant_slug text, tenant_name text, role text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT u.id, u.email, u.name, t.id, t.slug, t.name, m.role
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN (memberships m JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active')
             ON m.user_id = u.id
     WHERE s.token_hash = p_token_hash
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
     ORDER BY t.name
  $$;

CREATE FUNCTION app.revoke_session(p_token_hash text) RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ UPDATE sessions SET revoked_at = now() WHERE token_hash = p_token_hash AND revoked_at IS NULL $$;

REVOKE ALL ON FUNCTION app.signup(uuid, text, text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.login_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_session(uuid, text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.session_context(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revoke_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.signup(uuid, text, text, text, uuid, text, text) TO onefood_app;
GRANT EXECUTE ON FUNCTION app.login_lookup(text) TO onefood_app;
GRANT EXECUTE ON FUNCTION app.create_session(uuid, text, uuid, integer) TO onefood_app;
GRANT EXECUTE ON FUNCTION app.session_context(text) TO onefood_app;
GRANT EXECUTE ON FUNCTION app.revoke_session(text) TO onefood_app;

-- Editar um produto no painel troca o conjunto de grupos e opções por inteiro.
-- Os pedidos guardam uma cópia das opções escolhidas, então apagar aqui não muda o passado.
GRANT DELETE ON product_option_groups, product_options TO onefood_app;
