import { expect, test } from '@playwright/test';
import { createStore, errorMessage, openPanel } from './helpers';

test('sem sessão, o painel leva para o login', async ({ page }) => {
  const store = await createStore();
  for (const section of ['pedidos', 'cardapio', 'loja']) {
    await page.goto(`/painel/${store.slug}/${section}`);
    await expect(page).toHaveURL(/\/entrar$/);
  }
  await page.goto('/painel');
  await expect(page).toHaveURL(/\/entrar$/);
});

test('login: senha errada avisa, senha certa abre os pedidos da loja', async ({ page }) => {
  const store = await createStore();
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(store.email);
  await page.getByLabel('Senha').fill('senha-errada-000');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(errorMessage(page)).toHaveText('E-mail ou senha incorretos.');
  await expect(page).toHaveURL(/\/entrar$/);

  await page.getByLabel('Senha').fill(store.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`/painel/${store.slug}/pedidos$`));
  await expect(page.getByText(store.name)).toBeVisible();
});

test('o dono de uma loja não abre o painel de outra', async ({ browser }) => {
  const mine = await createStore();
  const theirs = await createStore();
  const page = await openPanel(browser, mine);
  await expect(page.getByText(mine.name)).toBeVisible();

  await page.goto(`/painel/${theirs.slug}/pedidos`);
  // Volta para a própria loja; nada da outra chega a aparecer.
  await expect(page).toHaveURL(new RegExp(`/painel/${mine.slug}/pedidos$`));
  await expect(page.getByText(theirs.name)).toHaveCount(0);

  const response = await page.request.get(`/api/v1/panel/stores/${theirs.slug}/orders`);
  expect(response.status()).toBe(404);
});

test('sair encerra a sessão, inclusive para quem guardou o cookie', async ({ browser }) => {
  const store = await createStore();
  const page = await openPanel(browser, store);
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar$/);

  // Uma cópia do cookie antigo não entra mais.
  const copy = await openPanel(browser, store);
  await expect(copy).toHaveURL(/\/entrar$/);
});

test('endereço de loja que não existe responde 404', async ({ page }) => {
  const response = await page.goto('/loja-que-nao-existe');
  expect(response?.status()).toBe(404);
});
