import { type Dialog, devices, expect, test } from '@playwright/test';
import { createStore, currentStep, fillAddress, fillCustomer, openPanel, openStorefront, placeOrder } from './helpers';

const WHERE = { latitude: -22.9056, longitude: -47.0608 };

test('entrega com motoboy próprio: link pessoal, saída, localização no mapa do cliente e conclusão', async ({
  browser,
}) => {
  const store = await createStore();
  const panel = await openPanel(browser, store, 'entregadores');
  let link = '';

  await test.step('o restaurante cadastra o entregador e recebe o link pessoal', async () => {
    await expect(panel.getByText('Nenhum entregador cadastrado ainda.')).toBeVisible();
    await panel.getByLabel('Nome').fill('João Batista');
    await panel.getByLabel('Telefone com DDD').fill('(11) 97777-6666');
    await panel.getByRole('button', { name: 'Cadastrar entregador' }).click();

    const box = panel.getByRole('region', { name: 'Link de acesso' });
    await expect(box).toContainText('Link de João Batista');
    link = await box.getByLabel('Link de acesso do entregador').inputValue();
    expect(link).toMatch(/\/entregador\/[A-Za-z0-9_-]{43}$/);
    // O atalho de WhatsApp vai para o número do entregador e leva o link.
    const whatsapp = await box.getByRole('link', { name: 'Enviar por WhatsApp' }).getAttribute('href');
    expect(whatsapp).toContain('https://wa.me/5511977776666?text=');
    expect(decodeURIComponent(whatsapp ?? '')).toContain(link);
    await expect(panel.getByRole('listitem').filter({ hasText: 'João Batista' })).toContainText('(11) 97777-6666');
  });

  const customer = await openStorefront(browser, store.slug);
  await test.step('o cliente faz um pedido de entrega', async () => {
    await customer.getByRole('button', { name: /X-Salada/ }).click();
    await customer.getByText('Ao ponto').click();
    await customer.getByRole('button', { name: /Adicionar/ }).click();
    await customer.getByRole('button', { name: /Ver pedido/ }).click();
    await fillCustomer(customer);
    await fillAddress(customer);
    await placeOrder(customer);
  });

  const courierContext = await browser.newContext({
    ...devices['Pixel 7'],
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    geolocation: WHERE,
    permissions: ['geolocation'],
  });
  const courier = await courierContext.newPage();

  await test.step('o restaurante atribui o pedido e leva até pronto', async () => {
    await panel.getByRole('link', { name: 'Pedidos' }).click();
    const card = panel.getByRole('article').filter({ hasText: 'Pedido 1' });
    await card.getByLabel('Entregador do pedido 1').selectOption({ label: 'João Batista' });
    await expect(card.getByLabel('Entregador do pedido 1')).toHaveValue(/.+/);
    // O cliente fica sabendo quem vai levar.
    await expect(customer.getByText('João vai levar o seu pedido')).toBeVisible({ timeout: 20_000 });

    await courier.goto(link);
    await expect(courier.getByRole('heading', { name: 'Olá, João' })).toBeVisible();
    const delivery = courier.getByRole('article').filter({ hasText: 'Pedido 1' });
    await expect(delivery).toContainText('Carlos Lima');
    await expect(delivery).toContainText('Rua das Flores, 120');
    await expect(delivery).toContainText('Receber R$ 34,00 em dinheiro');
    // A cozinha ainda não aprontou: o entregador não tem o que marcar.
    await expect(delivery).toContainText('Aguardando a cozinha.');

    for (const action of ['Confirmar', 'Iniciar preparo', 'Marcar como pronto']) {
      await card.getByRole('button', { name: action }).click();
    }
  });

  await test.step('o entregador compartilha a localização e sai para a entrega', async () => {
    await courier.getByRole('button', { name: 'Compartilhar localização' }).click();
    await expect(courier.getByText('Compartilhando')).toBeVisible();
    const delivery = courier.getByRole('article').filter({ hasText: 'Pedido 1' });
    await delivery.getByRole('button', { name: 'Saí para entrega' }).click({ timeout: 20_000 });
    await expect(delivery.getByRole('button', { name: 'Entreguei' })).toBeVisible();
  });

  await test.step('o cliente vê o entregador no mapa; o painel acompanha', async () => {
    await expect(customer.getByText('João está a caminho')).toBeVisible({ timeout: 20_000 });
    const map = customer.getByRole('img', { name: 'Mapa com a posição de João' });
    await expect(map).toHaveAttribute('data-lat', '-22.90560');
    await expect(map).toHaveAttribute('data-lng', '-47.06080');
    await expect(customer.locator('.courier-pin')).toBeVisible();
    await expect(customer.getByText(/Posição atualizada às \d{2}:\d{2}\./)).toBeVisible();
    await expect(
      panel.getByRole('region', { name: 'Em entrega' }).getByRole('heading', { name: 'Pedido 1' }),
    ).toBeVisible();
  });

  await test.step('o entregador conclui; o pedido fecha para todos', async () => {
    await courier.getByRole('button', { name: 'Entreguei' }).click();
    await expect(courier.getByText('Nenhuma entrega com você agora.')).toBeVisible();
    await expect(panel.getByRole('article').filter({ hasText: 'Pedido 1' })).toHaveCount(0);
    await expect(currentStep(customer)).toHaveText('Concluído', { timeout: 20_000 });
    // Entrega feita: a posição do entregador deixa de ser mostrada.
    await expect(customer.getByRole('img', { name: 'Mapa com a posição de João' })).toHaveCount(0);
  });

  await test.step('trocar o link derruba o antigo', async () => {
    await panel.getByRole('link', { name: 'Entregadores' }).click();
    panel.once('dialog', (dialog: Dialog) => void dialog.accept());
    await panel
      .getByRole('listitem')
      .filter({ hasText: 'João Batista' })
      .getByRole('button', { name: 'Novo link' })
      .click();
    const fresh = await panel.getByLabel('Link de acesso do entregador').inputValue();
    expect(fresh).not.toBe(link);

    await courier.goto(link);
    await expect(courier.getByRole('heading', { name: 'Link sem validade' })).toBeVisible();
    await courier.goto(fresh);
    await expect(courier.getByRole('heading', { name: 'Olá, João' })).toBeVisible();
  });
});

test('link de entregador inventado não mostra nada', async ({ page }) => {
  await page.goto(`/entregador/${'x'.repeat(43)}`);
  await expect(page.getByRole('heading', { name: 'Link sem validade' })).toBeVisible();
  await expect(page.getByText('Peça um novo ao restaurante.')).toBeVisible();
});
