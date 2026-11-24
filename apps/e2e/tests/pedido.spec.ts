import { type Dialog, expect, test } from '@playwright/test';
import {
  addRefrigerante,
  createStore,
  currentStep,
  errorMessage,
  fillAddress,
  fillCustomer,
  openPanel,
  openStorefront,
  placeOrder,
} from './helpers';

test('pedido de entrega: do carrinho do cliente à conclusão no painel', async ({ browser }) => {
  const store = await createStore();
  const panel = await openPanel(browser, store);
  await expect(panel.getByText('Ao vivo')).toBeVisible();
  const customer = await openStorefront(browser, store.slug);

  await test.step('o cliente escolhe as opções e monta o carrinho', async () => {
    await customer.getByRole('button', { name: /X-Salada/ }).click();
    const add = customer.getByRole('button', { name: /Adicionar/ });
    // Opção obrigatória ainda não escolhida.
    await expect(add).toBeDisabled();
    await customer.getByText('Ao ponto').click();
    await customer.getByText('Bacon').click();
    await customer.getByRole('button', { name: 'Aumentar quantidade' }).click();
    await customer.getByLabel('Alguma observação?').fill('sem cebola');
    // (28,00 + 5,00) x 2
    await expect(add).toContainText('R$ 66,00');
    await add.click();
    await customer.getByRole('button', { name: /Ver pedido \(2\)/ }).click();
  });

  await test.step('finaliza com entrega', async () => {
    await fillCustomer(customer);
    await fillAddress(customer);
    await customer.getByLabel('Observação para a loja').fill('troco para 100');
    await expect(customer.locator('.total')).toContainText('R$ 72,00');
    expect(await placeOrder(customer)).toBe('1');
    await expect(currentStep(customer)).toHaveText('Recebido');
    await expect(customer.locator('.total')).toContainText('R$ 72,00');
  });

  const card = panel.getByRole('article').filter({ hasText: 'Pedido 1' });
  await test.step('o pedido chega ao painel sem recarregar a página', async () => {
    await expect(panel.getByRole('region', { name: 'Novos' }).getByRole('heading', { name: 'Pedido 1' })).toBeVisible();
    await expect(card).toContainText('2 x X-Salada');
    await expect(card).toContainText('Ao ponto, Bacon');
    await expect(card).toContainText('Obs.: sem cebola');
    await expect(card).toContainText('Obs. do pedido: troco para 100');
    await expect(card).toContainText('Carlos Lima');
    await expect(card).toContainText('(11) 98888-7777');
    await expect(card).toContainText('Rua das Flores, 120');
    await expect(card).toContainText('R$ 72,00');
  });

  await test.step('o restaurante avança o pedido e o cliente acompanha', async () => {
    await card.getByRole('button', { name: 'Confirmar' }).click();
    await card.getByRole('button', { name: 'Iniciar preparo' }).click();
    await card.getByRole('button', { name: 'Marcar como pronto' }).click();
    await expect(
      panel.getByRole('region', { name: 'Prontos' }).getByRole('heading', { name: 'Pedido 1' }),
    ).toBeVisible();
    await card.getByRole('button', { name: 'Saiu para entrega' }).click();
    await expect(
      panel.getByRole('region', { name: 'Em entrega' }).getByRole('heading', { name: 'Pedido 1' }),
    ).toBeVisible();
    // A página do cliente se atualiza sozinha, a cada 10 segundos.
    await expect(currentStep(customer)).toHaveText('Saiu para entrega', { timeout: 20_000 });

    await card.getByRole('button', { name: 'Concluir' }).click();
    await expect(card).toHaveCount(0);
    await panel.getByRole('button', { name: /Ver encerrados/ }).click();
    await expect(panel.getByRole('listitem').filter({ hasText: 'Pedido 1' })).toContainText('Concluído');
    await expect(currentStep(customer)).toHaveText('Concluído', { timeout: 20_000 });
  });
});

test('pedido para retirada não pede endereço nem cobra entrega', async ({ browser }) => {
  const store = await createStore();
  const customer = await openStorefront(browser, store.slug);
  await addRefrigerante(customer);
  await customer.getByRole('button', { name: /Ver pedido/ }).click();

  await expect(customer.getByLabel('CEP')).toBeVisible();
  await customer.getByText('Retirar na loja').click();
  await expect(customer.getByLabel('CEP')).toHaveCount(0);
  await expect(customer.locator('.total')).toContainText('R$ 7,00');
  await fillCustomer(customer, 'Bia Santos');
  await customer.getByText('Cartão').click();
  await placeOrder(customer);
  await expect(customer.getByText('Saiu para entrega')).toHaveCount(0);
  await expect(customer.getByText('Pagamento: Cartão na entrega')).toBeVisible();

  // No painel, pedido de retirada vai de pronto direto para concluído.
  const panel = await openPanel(browser, store);
  const card = panel.getByRole('article').filter({ hasText: 'Bia Santos' });
  await expect(card).toContainText('Retirada');
  await card.getByRole('button', { name: 'Confirmar' }).click();
  await card.getByRole('button', { name: 'Iniciar preparo' }).click();
  await card.getByRole('button', { name: 'Marcar como pronto' }).click();
  await expect(card.getByRole('button', { name: 'Concluir' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Saiu para entrega' })).toHaveCount(0);
});

test('o carrinho sobrevive a um recarregamento e pode ser esvaziado', async ({ browser }) => {
  const store = await createStore();
  const customer = await openStorefront(browser, store.slug);
  await addRefrigerante(customer);
  await addRefrigerante(customer);
  await expect(customer.getByRole('button', { name: /Ver pedido \(2\)/ })).toContainText('R$ 14,00');

  await customer.reload();
  await customer.getByRole('button', { name: /Ver pedido \(2\)/ }).click();
  await customer.getByRole('button', { name: 'Aumentar Refrigerante lata' }).first().click();
  await expect(customer.locator('.total')).toContainText('R$ 27,00');

  for (let i = 0; i < 2; i++)
    await customer.getByRole('button', { name: 'Diminuir Refrigerante lata' }).first().click();
  await customer.getByRole('button', { name: 'Diminuir Refrigerante lata' }).click();
  await expect(customer.getByText('Seu carrinho está vazio.')).toBeVisible();
  await customer.getByRole('button', { name: 'Voltar ao cardápio' }).click();
  await expect(customer.getByRole('button', { name: /Ver pedido/ })).toHaveCount(0);
});

test('a finalização aponta telefone e CEP inválidos sem enviar o pedido', async ({ browser }) => {
  const store = await createStore();
  const customer = await openStorefront(browser, store.slug);
  await addRefrigerante(customer);
  await customer.getByRole('button', { name: /Ver pedido/ }).click();

  await customer.getByLabel('Seu nome').fill('Carlos Lima');
  await customer.getByLabel('Telefone com DDD').fill('98888-7777');
  await fillAddress(customer);
  await customer.getByRole('button', { name: 'Fazer pedido' }).click();
  await expect(errorMessage(customer)).toHaveText('Confira o telefone: informe o DDD e o número.');

  await customer.getByLabel('Telefone com DDD').fill('(11) 98888-7777');
  await customer.getByLabel('CEP').fill('1301');
  await customer.getByRole('button', { name: 'Fazer pedido' }).click();
  await expect(errorMessage(customer)).toHaveText('Confira o CEP: são 8 números.');
  await expect(customer).toHaveURL(new RegExp(`/${store.slug}$`));

  // Nenhum pedido chegou ao restaurante.
  const panel = await openPanel(browser, store);
  await expect(panel.getByRole('region', { name: 'Novos' }).getByText('Nenhum pedido.')).toBeVisible();
});

test('pedido cancelado pelo restaurante aparece como cancelado para o cliente', async ({ browser }) => {
  const store = await createStore();
  const customer = await openStorefront(browser, store.slug);
  await addRefrigerante(customer);
  await customer.getByRole('button', { name: /Ver pedido/ }).click();
  await customer.getByText('Retirar na loja').click();
  await fillCustomer(customer);
  await placeOrder(customer);

  const panel = await openPanel(browser, store);
  const card = panel.getByRole('article').filter({ hasText: 'Pedido 1' });
  // Recusar a confirmação mantém o pedido.
  panel.once('dialog', (dialog: Dialog) => dialog.dismiss());
  await card.getByRole('button', { name: 'Cancelar' }).click();
  await expect(card).toBeVisible();

  panel.once('dialog', (dialog: Dialog) => {
    expect(dialog.message()).toBe('Cancelar o pedido 1?');
    void dialog.accept();
  });
  await card.getByRole('button', { name: 'Cancelar' }).click();
  await expect(card).toHaveCount(0);
  await expect(customer.getByText('Este pedido foi cancelado pela loja.')).toBeVisible({ timeout: 20_000 });
});
