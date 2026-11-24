import { expect, type Page, test } from '@playwright/test';
import {
  addRefrigerante,
  createStore,
  fillAddress,
  fillCustomer,
  openPanel,
  openStorefront,
  placeOrder,
} from './helpers';

interface PrintJob {
  paper: string | null;
  kitchen: string | null;
  customer: string | null;
}

/**
 * No lugar da janela de impressão do navegador, guarda o que seria impresso:
 * o conteúdo de cada via e a largura de papel escolhida.
 */
async function capturePrints(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const jobs: PrintJob[] = [];
    (window as unknown as { __prints: PrintJob[] }).__prints = jobs;
    window.print = () => {
      const root = document.querySelector<HTMLElement>('.print-root');
      const all = (selector: string) => {
        const found = [...(root?.querySelectorAll(selector) ?? [])].map((element) => element.textContent ?? '');
        return found.length > 0 ? found.join(' | ') : null;
      };
      jobs.push({
        paper: root?.dataset.paper ?? null,
        kitchen: all('.ticket-kitchen'),
        customer: all('.ticket-customer'),
      });
    };
  });
  await page.reload();
}

const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: PrintJob[] }).__prints);

test('impressão: vias da cozinha e do cliente, ajustes do aparelho e impressão automática', async ({ browser }) => {
  const store = await createStore();
  const panel = await openPanel(browser, store);
  await capturePrints(panel);
  await expect(panel.getByText('Ao vivo')).toBeVisible();

  const customer = await openStorefront(browser, store.slug);
  await customer.getByRole('button', { name: /X-Salada/ }).click();
  await customer.getByText('Ao ponto').click();
  await customer.getByLabel('Alguma observação?').fill('sem cebola');
  await customer.getByRole('button', { name: /Adicionar/ }).click();
  await customer.getByRole('button', { name: /Ver pedido/ }).click();
  await fillCustomer(customer);
  await fillAddress(customer);
  await placeOrder(customer);

  const card = panel.getByRole('article').filter({ hasText: 'Pedido 1' });

  await test.step('o botão imprime as duas vias, cada uma com o que interessa', async () => {
    await expect(card).toContainText('Ainda não impresso');
    await card.getByRole('button', { name: 'Imprimir' }).click();
    const [job] = await prints(panel);
    expect(job?.paper).toBe('80');

    // Cozinha: o que preparar. Nada de valores nem dados do cliente.
    expect(job?.kitchen).toContain('PEDIDO 1');
    expect(job?.kitchen).toContain('ENTREGA');
    expect(job?.kitchen).toContain('1 x X-Salada');
    expect(job?.kitchen).toContain('Ao ponto');
    expect(job?.kitchen).toContain('OBS.: sem cebola');
    expect(job?.kitchen).not.toContain('R$');
    expect(job?.kitchen).not.toContain('Carlos Lima');

    // Cliente: vai com o pedido.
    expect(job?.customer).toContain(store.name);
    expect(job?.customer).toContain('Carlos Lima');
    expect(job?.customer).toContain('(11) 98888-7777');
    expect(job?.customer).toContain('Rua das Flores, 120');
    expect(job?.customer).toContain('CEP 13010-000');
    expect(job?.customer).toContain('TotalR$ 34,00');
    expect(job?.customer).toContain('Receber em dinheiro: R$ 34,00');

    await expect(card).toContainText(/Impresso às \d{2}:\d{2}/);
    await expect(card.getByRole('button', { name: 'Reimprimir' })).toBeVisible();
  });

  await test.step('no papel sai só a via; na tela ela não aparece', async () => {
    await expect(panel.locator('.ticket-kitchen')).toBeHidden();
    await panel.emulateMedia({ media: 'print' });
    await expect(panel.locator('.ticket-kitchen')).toBeVisible();
    await expect(panel.locator('.ticket-customer')).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Pedidos', exact: true })).toBeHidden();
    await expect(card).toBeHidden();
    await panel.emulateMedia({ media: 'screen' });
  });

  await test.step('os ajustes do aparelho mudam o que sai', async () => {
    await panel.getByRole('button', { name: 'Impressão' }).click();
    await panel.getByText('Via do cliente').click();
    await panel.getByLabel('Largura do papel').selectOption('58');
    await panel.getByRole('dialog').getByRole('button', { name: 'Fechar' }).click();

    await card.getByRole('button', { name: 'Reimprimir' }).click();
    const jobs = await prints(panel);
    expect(jobs).toHaveLength(2);
    expect(jobs[1]).toMatchObject({ paper: '58', customer: null });
    expect(jobs[1]?.kitchen).toContain('PEDIDO 1');
  });

  await test.step('com a impressão automática, pedido novo sai sozinho', async () => {
    await panel.getByRole('button', { name: 'Impressão' }).click();
    await panel.getByText('Imprimir sozinho quando chega um pedido novo').click();
    await panel.getByRole('dialog').getByRole('button', { name: 'Fechar' }).click();
    // O pedido 1 já tinha sido impresso: ligar o automático não o repete.
    await panel.waitForTimeout(500);
    expect(await prints(panel)).toHaveLength(2);

    const another = await openStorefront(browser, store.slug);
    await addRefrigerante(another);
    await another.getByRole('button', { name: /Ver pedido/ }).click();
    await another.getByText('Retirar na loja').click();
    await fillCustomer(another, 'Bia Santos');
    await placeOrder(another);

    await expect.poll(async () => (await prints(panel)).length, { timeout: 10_000 }).toBe(3);
    const last = (await prints(panel))[2];
    expect(last?.kitchen).toContain('PEDIDO 2');
    expect(last?.kitchen).toContain('RETIRADA');
    expect(last?.kitchen).toContain('1 x Refrigerante lata');
    await expect(panel.getByRole('article').filter({ hasText: 'Pedido 2' })).toContainText(/Impresso às/);
  });

  await test.step('recarregar mantém os ajustes e não reimprime o que já saiu', async () => {
    await panel.reload();
    await expect(panel.getByText('Ao vivo')).toBeVisible();
    await expect(panel.getByRole('article').filter({ hasText: 'Pedido 2' })).toContainText(/Impresso às/);
    await panel.waitForTimeout(1_000);
    expect(await prints(panel)).toHaveLength(0);

    await panel.getByRole('button', { name: 'Impressão' }).click();
    await expect(panel.getByLabel('Largura do papel')).toHaveValue('58');
    await expect(panel.getByRole('checkbox', { name: 'Imprimir sozinho quando chega um pedido novo' })).toBeChecked();
    await expect(panel.getByRole('checkbox', { name: 'Via do cliente' })).not.toBeChecked();
  });
});
