import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MeView } from '@onefood/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/modules/identity/passwords.js';
import { newId } from '../src/platform/ids.js';
import { createApiApp, sessionCookie, signupStore } from './helpers.js';

describe('senhas', () => {
  it('guarda só o hash, com sal diferente a cada vez', async () => {
    const first = await hashPassword('uma senha qualquer');
    const second = await hashPassword('uma senha qualquer');
    expect(first).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(first).not.toContain('uma senha qualquer');
    expect(first).not.toBe(second);
    expect(await verifyPassword('uma senha qualquer', first)).toBe(true);
    expect(await verifyPassword('outra senha', first)).toBe(false);
    expect(await verifyPassword('uma senha qualquer', 'formato-desconhecido')).toBe(false);
  });
});

describe('cadastro, login e sessão', () => {
  let app: NestFastifyApplication;
  let owner: pg.Client;

  beforeAll(async () => {
    app = await createApiApp();
    owner = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await owner.connect();
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  const signupBody = (overrides: Record<string, unknown> = {}) => {
    const unique = newId().replace(/-/g, '').slice(-16);
    return {
      name: 'Carlos Lima',
      email: `carlos-${unique}@exemplo.com.br`,
      password: 'uma-senha-bem-longa',
      storeName: 'Cantina do Carlos',
      storeSlug: `cantina-${unique}`,
      ...overrides,
    };
  };
  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, payload: payload as object, headers });

  it('o cadastro cria a conta, o restaurante e deixa o dono logado', async () => {
    const body = signupBody({ email: `  Carlos.${newId().slice(-8)}@Exemplo.com.br ` });
    const res = await post('/v1/auth/signup', body);
    expect(res.statusCode).toBe(201);
    const me = res.json<MeView>();
    expect(me.user.email).toBe((body.email as string).trim().toLowerCase());
    expect(me.stores).toEqual([{ slug: body.storeSlug, name: 'Cantina do Carlos', role: 'owner' }]);

    const cookie = res.headers['set-cookie'] as string;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');

    // A loja já responde no endereço público.
    const menu = await app.inject({ method: 'GET', url: `/v1/stores/${body.storeSlug}/menu` });
    expect(menu.statusCode).toBe(200);
    expect(menu.json().categories).toEqual([]);

    const session = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: sessionCookie(cookie) } });
    expect(session.json()).toEqual(me);
  });

  it('o banco não guarda senha nem token de sessão em claro', async () => {
    const body = signupBody();
    const res = await post('/v1/auth/signup', body);
    const token = decodeURIComponent(sessionCookie(res.headers['set-cookie']).split('=')[1] as string);

    const user = await owner.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = $1', [
      body.email,
    ]);
    expect(user.rows[0]?.password_hash).toMatch(/^scrypt\$/);
    expect(user.rows[0]?.password_hash).not.toContain(body.password);
    const sessions = await owner.query('SELECT 1 FROM sessions WHERE token_hash = $1', [token]);
    expect(sessions.rowCount).toBe(0);
  });

  it('recusa e-mail ou endereço de loja já usados, sem criar nada pela metade', async () => {
    const first = signupBody();
    await post('/v1/auth/signup', first);

    const sameEmail = await post('/v1/auth/signup', signupBody({ email: first.email }));
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.json()).toMatchObject({ error: 'email_taken' });

    const orphan = signupBody({ storeSlug: first.storeSlug });
    const sameSlug = await post('/v1/auth/signup', orphan);
    expect(sameSlug.statusCode).toBe(409);
    expect(sameSlug.json()).toMatchObject({ error: 'slug_taken' });
    // A conta não ficou criada sem restaurante: o mesmo e-mail ainda pode se cadastrar.
    const retry = await post('/v1/auth/signup', { ...orphan, storeSlug: `${orphan.storeSlug}-2` });
    expect(retry.statusCode).toBe(201);
  });

  it('valida os dados do cadastro', async () => {
    const invalid = [
      signupBody({ password: 'curta' }),
      signupBody({ email: 'sem-arroba' }),
      signupBody({ storeSlug: 'Com Espaço' }),
      signupBody({ storeSlug: 'painel' }),
      signupBody({ storeName: '' }),
    ];
    for (const body of invalid) {
      const res = await post('/v1/auth/signup', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('login devolve a mesma resposta para senha errada e e-mail desconhecido', async () => {
    const store = await signupStore(app, false);
    const good = await post('/v1/auth/login', { email: store.email.toUpperCase(), password: store.password });
    expect(good.statusCode).toBe(200);
    expect(good.json<MeView>().stores[0]?.slug).toBe(store.slug);

    const wrongPassword = await post('/v1/auth/login', { email: store.email, password: 'senha-errada-123' });
    const unknownEmail = await post('/v1/auth/login', { email: `x-${store.email}`, password: store.password });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(unknownEmail.json()).toEqual(wrongPassword.json());
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('sair encerra a sessão no servidor', async () => {
    const store = await signupStore(app, false);
    const me = () => app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: store.cookie } });
    expect((await me()).statusCode).toBe(200);

    const out = await post('/v1/auth/logout', undefined, { cookie: store.cookie });
    expect(out.statusCode).toBe(204);
    expect(out.headers['set-cookie']).toContain('Max-Age=0');
    // O cookie antigo, mesmo guardado por alguém, não vale mais.
    expect((await me()).statusCode).toBe(401);
  });

  it('sessão vencida ou inventada não entra', async () => {
    const store = await signupStore(app, false);
    await owner.query(
      `UPDATE sessions SET expires_at = now() - interval '1 minute'
        WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [store.email],
    );
    const expired = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: store.cookie } });
    expect(expired.statusCode).toBe(401);

    for (const cookie of ['', 'onefood_session=inventado', 'outro=valor']) {
      const res = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
      expect(res.statusCode, cookie).toBe(401);
    }
  });

  it('bloqueia tentativas seguidas de adivinhar a senha de uma conta', async () => {
    const store = await signupStore(app, false);
    const attempt = () => post('/v1/auth/login', { email: store.email, password: 'chute-errado-000' });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'rate_limited' });
    // Bloqueado inclusive com a senha certa, até a janela passar.
    const right = await post('/v1/auth/login', { email: store.email, password: store.password });
    expect(right.statusCode).toBe(429);
  });
});
