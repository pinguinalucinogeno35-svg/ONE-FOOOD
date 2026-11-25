import { devices, expect, test } from '@playwright/test';
import { addRefrigerante, currentStep, fillCustomer, placeOrder } from '../tests/helpers';

const email = process.env.DEMO_OWNER_EMAIL;
const password = process.env.DEMO_OWNER_PASSWORD;
/** Pasta para guardar capturas das telas, quando definida. */
const shots = process.env.DEMO_SCREENSHOTS;

/**
 * O caminho que prova que o ambiente inteiro está de pé: site, API, banco, fila, workers e
 * tempo real. O pedido só aparece no painel sem recarregar se todos eles estiverem ligados.
 */
test('demonstração no ar: o dono entra, o cliente pede e o pedido chega ao vivo', async ({ browser }) => {
  if (!email || !password) throw new Error('Defina DEMO_OWNER_EMAIL e DEMO_OWNER_PASSWORD.');

  const panel = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await test.step('o dono entra no painel da loja demo', async () => {
    await panel.goto('/entrar');
    await panel.getByLabel('E-mail').fill(email);
    await panel.getByLabel('Senha').fill(password);
    await panel.getByRole('button', { name: 'Entrar' }).click();
    await expect(panel).toHaveURL(/\/painel\/demo\/pedidos$/);
    await expect(panel.getByText('Pizzaria Demo')).toBeVisible();
    await expect(panel.getByText('Ao vivo')).toBeVisible();
  });

  // Nome único: a loja de demonstração acumula pedidos de quem a visita.
  const name = `Visita ${Date.now().toString(36)}`;
  const customer = await (
    await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  ).newPage();
  await test.step('o cliente faz um pedido para retirada', async () => {
    await customer.goto('/demo');
    await expect(customer.getByRole('heading', { name: 'Pizzaria Demo' })).toBeVisible();
    if (shots) await customer.screenshot({ path: `${shots}/demo-cardapio.png` });
    await addRefrigerante(customer);
    await customer.getByRole('button', { name: /Ver pedido/ }).click();
    await customer.getByText('Retirar na loja').click();
    await fillCustomer(customer, name);
    await placeOrder(customer);
    await expect(currentStep(customer)).toHaveText('Recebido');
  });

  const card = panel.getByRole('article').filter({ hasText: name });
  await test.step('o pedido chega ao painel sem recarregar e segue até o fim', async () => {
    await expect(card).toBeVisible();
    await expect(card).toContainText('Refrigerante lata');
    if (shots) await panel.screenshot({ path: `${shots}/demo-painel.png` });
    await card.getByRole('button', { name: 'Confirmar' }).click();
    await card.getByRole('button', { name: 'Iniciar preparo' }).click();
    await card.getByRole('button', { name: 'Marcar como pronto' }).click();
    await card.getByRole('button', { name: 'Concluir' }).click();
    await expect(card).toHaveCount(0);
    // A página do cliente se atualiza sozinha, a cada 10 segundos.
    await expect(currentStep(customer)).toHaveText('Concluído', { timeout: 30_000 });
    if (shots) await customer.screenshot({ path: `${shots}/demo-acompanhamento.png` });
  });
});
