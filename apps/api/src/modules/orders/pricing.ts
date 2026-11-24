import { type CreateOrderInput, multiplyCents, type OrderItemOptionView, sumCents } from '@onefood/shared';
import type { PricedProduct } from '../catalog/index.js';

export interface PricedLine {
  lineNo: number;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  options: OrderItemOptionView[];
  totalCents: number;
  notes: string | null;
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
}

export interface PricingProblem {
  path: string;
  code: 'product_unavailable' | 'option_unavailable' | 'option_repeated' | 'option_group_min' | 'option_group_max';
  detail: string;
}

export class PricingError extends Error {
  constructor(readonly problems: PricingProblem[]) {
    super('pedido inválido para o cardápio atual');
  }
}

/**
 * Calcula o pedido a partir do catálogo. O cliente só diz o que quer; todo valor
 * em dinheiro nasce aqui, em centavos inteiros.
 */
export function priceOrder(
  input: CreateOrderInput,
  catalog: ReadonlyMap<string, PricedProduct>,
  storeDeliveryFeeCents: number,
): PricedOrder {
  const problems: PricingProblem[] = [];
  const lines: PricedLine[] = [];

  input.items.forEach((item, index) => {
    const path = `items.${index}`;
    const product = catalog.get(item.productId);
    if (!product) {
      problems.push({ path, code: 'product_unavailable', detail: item.productId });
      return;
    }

    const chosen: OrderItemOptionView[] = [];
    const perGroup = new Map<string, number>();
    const seen = new Set<string>();
    for (const optionId of item.optionIds) {
      if (seen.has(optionId)) {
        problems.push({ path, code: 'option_repeated', detail: optionId });
        continue;
      }
      seen.add(optionId);
      const option = product.options.get(optionId);
      if (!option) {
        problems.push({ path, code: 'option_unavailable', detail: optionId });
        continue;
      }
      perGroup.set(option.groupId, (perGroup.get(option.groupId) ?? 0) + 1);
      chosen.push({
        optionId: option.id,
        groupName: option.groupName,
        name: option.name,
        priceDeltaCents: option.priceDeltaCents,
      });
    }

    for (const group of product.groups) {
      const count = perGroup.get(group.id) ?? 0;
      if (count < group.minSelect) problems.push({ path, code: 'option_group_min', detail: group.name });
      if (count > group.maxSelect) problems.push({ path, code: 'option_group_max', detail: group.name });
    }

    const unitPriceCents = sumCents([product.priceCents, ...chosen.map((option) => option.priceDeltaCents)]);
    lines.push({
      lineNo: index + 1,
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPriceCents,
      options: chosen,
      totalCents: multiplyCents(unitPriceCents, item.quantity),
      notes: item.notes ?? null,
    });
  });

  if (problems.length > 0) throw new PricingError(problems);

  const subtotalCents = sumCents(lines.map((line) => line.totalCents));
  const deliveryFeeCents = input.fulfillment === 'delivery' ? storeDeliveryFeeCents : 0;
  const discountCents = 0;
  return {
    lines,
    subtotalCents,
    deliveryFeeCents,
    discountCents,
    totalCents: subtotalCents + deliveryFeeCents - discountCents,
  };
}
