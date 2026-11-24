import { devices, expect, test } from '@playwright/test';
import { createStore, errorMessage, openPanel, unique } from './helpers';

test('o restaurante cria a loja, monta o cardápio e ele já aparece para o cliente', async ({ page, browser }) => {
  const id = unique();
  const slug = `cantina-do-ze-${id}`;

  await test.step('cadastro', async () => {
    await page.goto('/cadastro');
    await page.getByLabel('Nome do restaurante').fill(`Cantina do Zé ${id}`);
    // O endereço é sugerido a partir do nome, sem acento e sem espaço.
    await expect(page.getByLabel('Endereço do cardápio')).toHaveValue(slug);
    await page.getByLabel('Seu nome').fill('José Pereira');
    await page.getByLabel('E-mail').fill(`ze-${id}@exemplo.com.br`);
    await page.getByLabel('Senha').fill('senha-de-teste-123');
    await page.getByRole('button', { name: 'Criar loja' }).click();
    await expect(page).toHaveURL(new RegExp(`/painel/${slug}/cardapio$`));
    await expect(page.getByText('Comece criando uma categoria')).toBeVisible();
  });

  await test.step('categoria e produto com opções', async () => {
    await page.getByLabel('Nova categoria').fill('Massas');
    await page.getByRole('button', { name: 'Criar categoria' }).click();
    await expect(page.getByRole('heading', { name: 'Massas' })).toBeVisible();

    await page.getByRole('button', { name: 'Novo produto' }).click();
    await page.getByLabel('Nome', { exact: true }).fill('Lasanha');
    await page.getByLabel('Descrição').fill('Bolonhesa, gratinada no forno');
    await page.getByLabel('Preço (R$)').fill('42,50');
    await page.getByRole('button', { name: 'Grupo de opções' }).click();
    await page.getByLabel('Nome do grupo').fill('Tamanho');
    await page.getByText('Escolha obrigatória').click();
    await page.getByLabel('Nome da opção').fill('Individual');
    await page.getByRole('button', { name: 'Opção', exact: true }).click();
    await page.getByLabel('Nome da opção').nth(1).fill('Família');
    await page.getByLabel('Acréscimo em reais').nth(1).fill('30,00');
    await page.getByRole('button', { name: 'Salvar produto' }).click();

    const row = page.getByRole('listitem').filter({ hasText: 'Lasanha' });
    await expect(row).toContainText('R$ 42,50');
    await expect(row).toContainText('1 grupo de opções');
  });

  await test.step('taxa de entrega', async () => {
    await page.getByRole('link', { name: 'Loja' }).click();
    await page.getByLabel('Taxa de entrega (R$)').fill('8,00');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Alterações salvas.')).toBeVisible();
  });

  await test.step('cardápio público', async () => {
    const customer = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
    await customer.goto(`/${slug}`);
    await expect(customer.getByRole('heading', { name: `Cantina do Zé ${id}` })).toBeVisible();
    await expect(customer.getByText('Entrega: R$ 8,00')).toBeVisible();
    await customer.getByRole('button', { name: /Lasanha/ }).click();
    await expect(customer.getByText('mais R$ 30,00')).toBeVisible();
  });
});

test('recusa cadastro com endereço reservado ou e-mail já usado', async ({ page }) => {
  const existing = await createStore();
  await page.goto('/cadastro');
  await page.getByLabel('Nome do restaurante').fill('Painel');
  await page.getByLabel('Seu nome').fill('Maria');
  await page.getByLabel('E-mail').fill(existing.email);
  await page.getByLabel('Senha').fill('senha-de-teste-123');

  await expect(page.getByLabel('Endereço do cardápio')).toHaveValue('painel');
  await page.getByRole('button', { name: 'Criar loja' }).click();
  await expect(errorMessage(page)).toContainText('este endereço é reservado');

  await page.getByLabel('Endereço do cardápio').fill(`outra-${unique()}`);
  await page.getByRole('button', { name: 'Criar loja' }).click();
  await expect(errorMessage(page)).toHaveText('Já existe uma conta com este e-mail.');
  await expect(page).toHaveURL(/\/cadastro$/);
});

test('o que o restaurante muda no painel aparece no cardápio público na hora', async ({ browser }) => {
  const store = await createStore();
  const customer = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  // A primeira visita guarda a página em cache.
  await customer.goto(`/${store.slug}`);
  await expect(customer.getByRole('button', { name: /Refrigerante lata/ })).toBeVisible();

  const panel = await openPanel(browser, store, 'cardapio');
  const row = panel.getByRole('listitem').filter({ hasText: 'Refrigerante lata' });
  await row.getByRole('button', { name: 'Pausar' }).click();
  await expect(row).toContainText('Fora do cardápio');

  await customer.reload();
  await expect(customer.getByRole('button', { name: /X-Salada/ })).toBeVisible();
  await expect(customer.getByRole('button', { name: /Refrigerante lata/ })).toHaveCount(0);

  // Editar o preço também reflete em seguida.
  await panel.getByRole('button', { name: 'Editar X-Salada' }).click();
  await panel.getByLabel('Preço (R$)').fill('31,90');
  await panel.getByRole('button', { name: 'Salvar produto' }).click();
  await expect(panel.getByRole('listitem').filter({ hasText: 'X-Salada' })).toContainText('R$ 31,90');
  await customer.reload();
  await expect(customer.getByRole('button', { name: /X-Salada/ })).toContainText('R$ 31,90');
});
