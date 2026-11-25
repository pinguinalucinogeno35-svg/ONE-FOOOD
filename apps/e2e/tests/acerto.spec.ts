import { type Dialog, devices, expect, test } from '@playwright/test';
import { createStore, openPanel, panelApi, placeDeliveryByApi } from './helpers';

test('acerto com o entregador: o pendente, a regra de pagamento e o fechamento', async ({ browser }) => {
  const store = await createStore();
  const api = await panelApi(store);

  // Cenário: João fez três entregas, duas pagas em dinheiro (13,00 cada) e uma no cartão.
  const courier = await api.call<{ id: string; accessToken: string }>('post', '/couriers', {
    name: 'João Batista',
    phone: '+5511977776666',
  });
  for (const payment of ['cash', 'cash', 'card_on_delivery'] as const) {
    const orderId = await placeDeliveryByApi(store, payment);
    await api.call('post', `/orders/${orderId}/courier`, { courierId: courier.id });
    for (const status of ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed']) {
      await api.call('post', `/orders/${orderId}/status`, { status });
    }
  }
  await api.dispose();

  const panel = await openPanel(browser, store, 'entregadores');
  const pending = panel.getByRole('region', { name: 'Acerto pendente' }).getByRole('article');
  const courierPage = await (
    await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  ).newPage();

  await test.step('o painel mostra o que cada lado deve', async () => {
    await expect(pending).toContainText('João Batista');
    await expect(pending).toContainText('3 entregas desde');
    // Três entregas a 6,00 de taxa; duas de 13,00 em dinheiro.
    await expect(pending).toContainText('A pagar ao entregadorR$ 18,00');
    await expect(pending).toContainText('Dinheiro recebido por eleR$ 26,00');
    await expect(pending).toContainText('João Batista repassa R$ 8,00 ao restaurante');
  });

  await test.step('o entregador vê a mesma conta na página dele', async () => {
    await courierPage.goto(`/entregador/${courier.accessToken}`);
    const mine = courierPage.getByRole('region', { name: 'Meu acerto' });
    await expect(mine).toContainText('3 entregas');
    await expect(mine).toContainText('A receber pelas entregasR$ 18,00');
    await expect(mine).toContainText('Dinheiro que está com vocêR$ 26,00');
    await expect(mine).toContainText('Você repassa R$ 8,00 ao restaurante');
  });

  await test.step('mudar o valor por entrega refaz a conta do que está pendente', async () => {
    const row = panel.getByRole('listitem').filter({ hasText: '(11) 97777-6666' });
    await expect(row).toContainText('recebe a taxa de entrega de cada pedido');
    await row.getByRole('button', { name: 'Valor por entrega' }).click();
    const dialog = panel.getByRole('dialog');
    await expect(dialog).toContainText('Quanto João Batista recebe por entrega');
    await dialog.getByRole('textbox').fill('10,00');
    await dialog.getByRole('button', { name: 'Salvar' }).click();

    await expect(row).toContainText('recebe R$ 10,00 por entrega');
    await expect(pending).toContainText('A pagar ao entregadorR$ 30,00');
    // Agora é o restaurante que deve.
    await expect(pending).toContainText('O restaurante paga R$ 4,00 a João Batista');
  });

  await test.step('fechar o acerto zera o pendente e registra no histórico', async () => {
    // Desistir na confirmação não fecha nada.
    panel.once('dialog', (dialog: Dialog) => void dialog.dismiss());
    await pending.getByRole('button', { name: 'Fechar acerto' }).click();
    await expect(pending).toBeVisible();

    panel.once('dialog', (dialog: Dialog) => {
      expect(dialog.message()).toBe('Fechar o acerto de João Batista? O restaurante paga R$ 4,00 a João Batista.');
      void dialog.accept();
    });
    await pending.getByRole('button', { name: 'Fechar acerto' }).click();
    await expect(panel.getByRole('region', { name: 'Acerto pendente' })).toHaveCount(0);

    const history = panel.getByRole('region', { name: 'Últimos acertos' }).getByRole('listitem');
    await expect(history).toHaveCount(1);
    await expect(history).toContainText('João Batista · 3 entregas');
    await expect(history).toContainText('A pagar R$ 30,00 · dinheiro recebido R$ 26,00');
    await expect(history).toContainText('O restaurante paga R$ 4,00 a João Batista');

    await courierPage.reload();
    await expect(courierPage.getByRole('region', { name: 'Meu acerto' })).toContainText('Nada a acertar');
  });
});
