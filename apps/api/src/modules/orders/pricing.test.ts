import type { CreateOrderInput } from '@onefood/shared';
import { describe, expect, it } from 'vitest';
import type { PricedProduct } from '../catalog/index.js';
import { PricingError, priceOrder } from './pricing.js';

const pizza: PricedProduct = {
  id: 'pizza',
  name: 'Pizza',
  priceCents: 4500,
  groups: [
    { id: 'size', name: 'Tamanho', minSelect: 1, maxSelect: 1 },
    { id: 'extras', name: 'Adicionais', minSelect: 0, maxSelect: 2 },
  ],
  options: new Map([
    ['large', { id: 'large', groupId: 'size', groupName: 'Tamanho', name: 'Grande', priceDeltaCents: 1200 }],
    ['bacon', { id: 'bacon', groupId: 'extras', groupName: 'Adicionais', name: 'Bacon', priceDeltaCents: 600 }],
  ]),
};
const catalog = new Map([[pizza.id, pizza]]);

function order(
  items: CreateOrderInput['items'],
  fulfillment: CreateOrderInput['fulfillment'] = 'pickup',
): CreateOrderInput {
  return { customer: { name: 'Ana', phone: '+5511999990000' }, fulfillment, paymentMethod: 'cash', items };
}

describe('cálculo do pedido', () => {
  it('soma opções ao preço unitário e multiplica pela quantidade', () => {
    const priced = priceOrder(
      order([{ productId: 'pizza', quantity: 3, optionIds: ['large', 'bacon'] }]),
      catalog,
      600,
    );
    expect(priced.lines[0]).toMatchObject({ unitPriceCents: 6300, totalCents: 18900 });
    expect(priced).toMatchObject({ subtotalCents: 18900, deliveryFeeCents: 0, totalCents: 18900 });
  });

  it('cobra taxa de entrega só em pedido de entrega', () => {
    const items = [{ productId: 'pizza', quantity: 1, optionIds: ['large'] }];
    expect(priceOrder(order(items, 'delivery'), catalog, 600).totalCents).toBe(6300);
    expect(priceOrder(order(items, 'dine_in'), catalog, 600).totalCents).toBe(5700);
  });

  it('reúne todos os problemas do pedido em um único erro', () => {
    try {
      priceOrder(
        order([
          { productId: 'pizza', quantity: 1, optionIds: [] },
          { productId: 'sumiu', quantity: 1, optionIds: [] },
        ]),
        catalog,
        0,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PricingError);
      expect((error as PricingError).problems).toEqual([
        { path: 'items.0', code: 'option_group_min', detail: 'Tamanho' },
        { path: 'items.1', code: 'product_unavailable', detail: 'sumiu' },
      ]);
    }
  });
});
