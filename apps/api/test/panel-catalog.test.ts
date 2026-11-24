import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AdminMenuView, MenuView } from '@onefood/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/platform/ids.js';
import { createApiApp, type PanelStore, sessionCookie, signupStore } from './helpers.js';

describe('gestão do cardápio no painel', () => {
  let app: NestFastifyApplication;
  let owner: pg.Client;
  let store: PanelStore;
  let other: PanelStore;

  beforeAll(async () => {
    app = await createApiApp();
    owner = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await owner.connect();
    store = await signupStore(app, false);
    other = await signupStore(app);
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    payload?: unknown,
    as: PanelStore | null = store,
  ) =>
    app.inject({
      method,
      url: `/v1/panel/stores/${store.slug}${path}`,
      payload: payload as object,
      headers: as ? { cookie: as.cookie } : {},
    });
  const adminMenu = async () => (await call('GET', '/menu')).json<AdminMenuView>();
  const publicMenu = async () =>
    (await app.inject({ method: 'GET', url: `/v1/stores/${store.slug}/menu` })).json<MenuView>();

  it('monta o cardápio do zero e ele aparece no endereço público', async () => {
    const category = (await call('POST', '/categories', { name: 'Lanches' })).json<{ id: string }>();
    const created = await call('POST', '/products', {
      categoryId: category.id,
      name: 'X-Salada',
      description: 'Pão, hambúrguer, queijo e salada',
      priceCents: 2800,
    });
    expect(created.statusCode).toBe(201);
    const product = created.json<{ id: string }>();

    const groups = await call('PUT', `/products/${product.id}/option-groups`, {
      groups: [
        {
          name: 'Ponto da carne',
          minSelect: 1,
          maxSelect: 1,
          options: [{ name: 'Ao ponto' }, { name: 'Bem passado' }],
        },
        { name: 'Adicionais', minSelect: 0, maxSelect: 3, options: [{ name: 'Bacon', priceDeltaCents: 500 }] },
      ],
    });
    expect(groups.statusCode).toBe(204);
    expect((await call('PATCH', '', { deliveryFeeCents: 750, name: 'Lanchonete da Ana' })).statusCode).toBe(204);

    const menu = await publicMenu();
    expect(menu.store).toEqual({ slug: store.slug, name: 'Lanchonete da Ana', deliveryFeeCents: 750 });
    expect(menu.categories).toHaveLength(1);
    const listed = menu.categories[0]?.products[0];
    expect(listed).toMatchObject({ name: 'X-Salada', priceCents: 2800 });
    expect(listed?.optionGroups.map((group) => [group.name, group.minSelect, group.options.length])).toEqual([
      ['Ponto da carne', 1, 2],
      ['Adicionais', 0, 1],
    ]);
  });

  it('altera preço e nome, e produto desativado some do público mas fica no painel', async () => {
    const product = (await adminMenu()).categories[0]?.products[0];
    if (!product) throw new Error('produto não encontrado');

    expect(
      (await call('PATCH', `/products/${product.id}`, { priceCents: 3100, name: 'X-Salada Especial' })).statusCode,
    ).toBe(204);
    expect((await publicMenu()).categories[0]?.products[0]).toMatchObject({
      name: 'X-Salada Especial',
      priceCents: 3100,
    });

    await call('PATCH', `/products/${product.id}`, { active: false });
    expect((await publicMenu()).categories).toEqual([]);
    expect((await adminMenu()).categories[0]?.products[0]).toMatchObject({ id: product.id, active: false });
    await call('PATCH', `/products/${product.id}`, { active: true });
  });

  it('trocar os grupos de opções substitui o conjunto anterior por inteiro', async () => {
    const product = (await adminMenu()).categories[0]?.products[0];
    if (!product) throw new Error('produto não encontrado');
    await call('PUT', `/products/${product.id}/option-groups`, {
      groups: [{ name: 'Molho', minSelect: 0, maxSelect: 1, options: [{ name: 'Maionese verde' }] }],
    });
    expect((await adminMenu()).categories[0]?.products[0]?.optionGroups.map((group) => group.name)).toEqual(['Molho']);

    await call('PUT', `/products/${product.id}/option-groups`, { groups: [] });
    expect((await adminMenu()).categories[0]?.products[0]?.optionGroups).toEqual([]);
  });

  it('valida entradas e referências', async () => {
    const category = (await adminMenu()).categories[0];
    if (!category) throw new Error('categoria não encontrada');
    const cases: Array<['POST' | 'PATCH' | 'PUT', string, unknown, number]> = [
      ['POST', '/categories', { name: '' }, 400],
      ['POST', '/products', { categoryId: category.id, name: 'Sem preço' }, 400],
      ['POST', '/products', { categoryId: category.id, name: 'Negativo', priceCents: -1 }, 400],
      ['POST', '/products', { categoryId: category.id, name: 'Quebrado', priceCents: 10.5 }, 400],
      ['POST', '/products', { categoryId: newId(), name: 'Órfão', priceCents: 100 }, 422],
      ['PATCH', `/products/${newId()}`, { priceCents: 100 }, 404],
      ['PATCH', '/products/nao-e-uuid', { priceCents: 100 }, 400],
      ['PATCH', `/categories/${category.id}`, {}, 400],
      ['PATCH', `/categories/${newId()}`, { name: 'Fantasma' }, 404],
      ['PUT', `/products/${newId()}/option-groups`, { groups: [] }, 404],
      [
        'PUT',
        `/products/${category.products[0]?.id}/option-groups`,
        { groups: [{ name: 'Impossível', minSelect: 2, maxSelect: 1, options: [{ name: 'A' }] }] },
        400,
      ],
      [
        'PUT',
        `/products/${category.products[0]?.id}/option-groups`,
        {
          groups: [{ name: 'Sem opções ativas', minSelect: 1, maxSelect: 1, options: [{ name: 'A', active: false }] }],
        },
        400,
      ],
    ];
    for (const [method, path, body, status] of cases) {
      const res = await call(method, path, body);
      expect(res.statusCode, `${method} ${path} ${JSON.stringify(body)}`).toBe(status);
    }
  });

  it('exige sessão e vínculo com o restaurante', async () => {
    expect((await call('GET', '/menu', undefined, null)).statusCode).toBe(401);
    expect((await call('POST', '/categories', { name: 'Sem login' }, null)).statusCode).toBe(401);

    // Dono de outro restaurante: mesma resposta de loja inexistente, e nada é alterado.
    expect((await call('GET', '/menu', undefined, other)).statusCode).toBe(404);
    expect((await call('POST', '/categories', { name: 'Invasão' }, other)).statusCode).toBe(404);
    expect((await adminMenu()).categories.map((category) => category.name)).not.toContain('Invasão');
  });

  it('não altera produto de outro restaurante mesmo conhecendo o id', async () => {
    const res = await call('PATCH', `/products/${other.menu.margherita}`, { priceCents: 1 });
    expect(res.statusCode).toBe(404);
    const intact = await owner.query<{ price_cents: number }>('SELECT price_cents FROM products WHERE id = $1', [
      other.menu.margherita,
    ]);
    expect(intact.rows[0]?.price_cents).toBe(4500);
  });

  it('recusa alteração vinda de outra origem', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/panel/stores/${store.slug}/categories`,
      payload: { name: 'De outro site' },
      headers: { cookie: store.cookie, origin: 'https://site-malicioso.example' },
    });
    expect(res.statusCode).toBe(403);
    const fromSite = await app.inject({
      method: 'POST',
      url: `/v1/panel/stores/${store.slug}/categories`,
      payload: { name: 'Do próprio site' },
      headers: { cookie: store.cookie, origin: 'http://localhost:3100' },
    });
    expect(fromSite.statusCode).toBe(201);
  });

  it('funcionário vê o cardápio mas não altera', async () => {
    const staff = await signupStore(app, false);
    await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       SELECT $1, id, 'staff' FROM users WHERE email = $2`,
      [store.tenantId, staff.email],
    );
    // Nova sessão: os vínculos são lidos do banco a cada requisição.
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: staff.email, password: staff.password },
    });
    const asStaff = { ...staff, cookie: sessionCookie(login.headers['set-cookie']) };

    expect((await call('GET', '/menu', undefined, asStaff)).statusCode).toBe(200);
    const denied = await call('POST', '/categories', { name: 'Não pode' }, asStaff);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'role_not_allowed' });
  });
});
