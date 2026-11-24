import { expect, test } from '@playwright/test';
import { createStore, errorMessage, fillAddress, fillCustomer, openPanel, openStorefront, placeOrder } from './helpers';

test('cupom: o restaurante cria no painel, o cliente aplica e o desconto vale no pedido', async ({ browser }) => {
  const store = await createStore();
  const panel = await openPanel(browser, store, 'cupons');

  await test.step('o restaurante cria o cupom', async () => {
    await expect(panel.getByText('Nenhum cupom ainda.')).toBeVisible();
    await panel.getByLabel('Código').fill('bemvindo10');
    await panel.getByLabel('Desconto (%)').fill('10');
    await panel.getByRole('button', { name: 'Criar cupom' }).click();
    const row = panel.getByRole('listitem').filter({ hasText: 'BEMVINDO10' });
    await expect(row).toContainText('10% de desconto');
    await expect(row).toContainText('0 usos · um por cliente');
  });

  const customer = await openStorefront(browser, store.slug);
  const order = async () => {
    await customer.goto(`/${store.slug}`);
    await customer.getByRole('button', { name: /X-Salada/ }).click();
    await customer.getByText('Ao ponto').click();
    await customer.getByRole('button', { name: /Adicionar/ }).click();
    await customer.getByRole('button', { name: /Ver pedido/ }).click();
    await fillCustomer(customer);
    await fillAddress(customer);
  };

  await test.step('código errado avisa; código certo aplica o desconto só nos itens', async () => {
    await order();
    await customer.getByLabel('Cupom de desconto').fill('naoexiste');
    await customer.getByRole('button', { name: 'Aplicar' }).click();
    await expect(customer.getByText('Cupom não encontrado. Confira o código.')).toBeVisible();

    await customer.getByLabel('Cupom de desconto').fill('bemvindo10');
    await customer.getByRole('button', { name: 'Aplicar' }).click();
    await expect(customer.getByText('Cupom BEMVINDO10 aplicado')).toBeVisible();
    // 28,00 de itens, 10% de desconto = 2,80; entrega de 6,00 sem desconto.
    await expect(customer.locator('.totals')).toContainText('-R$ 2,80');
    await expect(customer.locator('.total')).toContainText('R$ 31,20');

    // Mudar o carrinho refaz a conta do desconto.
    await customer.getByRole('button', { name: 'Aumentar X-Salada' }).click();
    await expect(customer.locator('.totals')).toContainText('-R$ 5,60');
    await customer.getByRole('button', { name: 'Diminuir X-Salada' }).click();
    await expect(customer.locator('.total')).toContainText('R$ 31,20');
  });

  await test.step('o pedido sai com o desconto e o restaurante vê o cupom', async () => {
    await placeOrder(customer);
    await expect(customer.locator('.totals')).toContainText('Desconto (BEMVINDO10)');
    await expect(customer.locator('.total')).toContainText('R$ 31,20');

    await panel.getByRole('link', { name: 'Pedidos' }).click();
    const card = panel.getByRole('article').filter({ hasText: 'Pedido 1' });
    await expect(card).toContainText('Cupom BEMVINDO10: -R$ 2,80');
    await expect(card).toContainText('R$ 31,20');
    await panel.getByRole('link', { name: 'Cupons' }).click();
    await expect(panel.getByRole('listitem').filter({ hasText: 'BEMVINDO10' })).toContainText('1 uso · um por cliente');
  });

  await test.step('o mesmo cliente não usa o cupom duas vezes', async () => {
    await order();
    await customer.getByLabel('Cupom de desconto').fill('BEMVINDO10');
    await customer.getByRole('button', { name: 'Aplicar' }).click();
    await expect(customer.getByText('Cupom BEMVINDO10 aplicado')).toBeVisible();
    await customer.getByRole('button', { name: 'Fazer pedido' }).click();
    await expect(errorMessage(customer)).toHaveText('Você já usou este cupom.');

    // Sem o cupom, o pedido segue pelo valor cheio.
    await customer.getByRole('button', { name: 'Remover cupom' }).click();
    await expect(customer.locator('.total')).toContainText('R$ 34,00');
    expect(await placeOrder(customer)).toBe('2');
  });

  await test.step('cupom desligado deixa de valer', async () => {
    const row = panel.getByRole('listitem').filter({ hasText: 'BEMVINDO10' });
    await row.getByRole('button', { name: 'Desligar' }).click();
    await expect(row).toContainText('Desligado');

    const another = await openStorefront(browser, store.slug);
    await another.getByRole('button', { name: /Refrigerante lata/ }).click();
    await another.getByRole('button', { name: /Adicionar/ }).click();
    await another.getByRole('button', { name: /Ver pedido/ }).click();
    await another.getByLabel('Cupom de desconto').fill('BEMVINDO10');
    await another.getByRole('button', { name: 'Aplicar' }).click();
    await expect(another.getByText('Este cupom não está mais valendo.')).toBeVisible();
  });
});

test('avaliação: o cliente dá nota baixa e o painel avisa na hora', async ({ browser }) => {
  const store = await createStore();
  const customer = await openStorefront(browser, store.slug);

  await test.step('pedido com dois itens, para retirada', async () => {
    await customer.getByRole('button', { name: /X-Salada/ }).click();
    await customer.getByText('Ao ponto').click();
    await customer.getByRole('button', { name: /Adicionar/ }).click();
    await customer.getByRole('button', { name: /Refrigerante lata/ }).click();
    await customer.getByRole('button', { name: /Adicionar/ }).click();
    await customer.getByRole('button', { name: /Ver pedido/ }).click();
    await customer.getByText('Retirar na loja').click();
    await fillCustomer(customer, 'Paula Reis');
    await placeOrder(customer);
    // Pedido em andamento ainda não pode ser avaliado.
    await expect(customer.getByText('Como foi o seu pedido?')).toHaveCount(0);
  });

  const panel = await openPanel(browser, store);
  await test.step('o restaurante conclui o pedido', async () => {
    await expect(panel.getByText('Ao vivo')).toBeVisible();
    const card = panel.getByRole('article').filter({ hasText: 'Pedido 1' });
    for (const action of ['Confirmar', 'Iniciar preparo', 'Marcar como pronto', 'Concluir']) {
      await card.getByRole('button', { name: action }).click();
    }
    await expect(card).toHaveCount(0);
  });

  await test.step('o cliente avalia', async () => {
    await expect(customer.getByText('Como foi o seu pedido?')).toBeVisible({ timeout: 20_000 });
    await customer.getByRole('button', { name: 'Enviar avaliação' }).click();
    await expect(errorMessage(customer)).toHaveText('Escolha uma nota de 1 a 5.');

    await customer.getByRole('radiogroup', { name: 'Nota do pedido' }).getByRole('radio', { name: '2 de 5' }).click();
    await customer.getByRole('radiogroup', { name: 'Nota de X-Salada' }).getByRole('radio', { name: '1 de 5' }).click();
    await customer
      .getByRole('radiogroup', { name: 'Nota de Refrigerante lata' })
      .getByRole('radio', { name: '5 de 5' })
      .click();
    await customer.getByLabel('Quer contar mais?').fill('O lanche chegou frio.');
    await customer.getByRole('button', { name: 'Enviar avaliação' }).click();
    await expect(customer.getByText('Obrigado pela avaliação')).toBeVisible();
    await expect(customer.getByRole('img', { name: 'Sua nota: 2 de 5' })).toBeVisible();

    // Recarregar mostra a avaliação já feita, sem o formulário.
    await customer.reload();
    await expect(customer.getByText('Obrigado pela avaliação')).toBeVisible();
    await expect(customer.getByRole('button', { name: 'Enviar avaliação' })).toHaveCount(0);
  });

  await test.step('o painel avisa da nota baixa sem recarregar e mostra o resumo', async () => {
    const banner = panel.getByRole('alert').filter({ hasText: 'Nota baixa' });
    await expect(banner).toContainText('Nota baixa no pedido 1: 2 de 5.');
    await banner.getByRole('link', { name: 'Ver avaliações' }).click();

    await expect(panel.locator('.stats')).toContainText('2,0');
    const worst = panel.getByRole('listitem').filter({ hasText: 'X-Salada' }).first();
    await expect(worst).toContainText('1,0');
    const review = panel.getByRole('listitem').filter({ hasText: 'Paula Reis' });
    await expect(review).toContainText('O lanche chegou frio.');
    await expect(review).toContainText('X-Salada: 1, Refrigerante lata: 5');
  });
});
