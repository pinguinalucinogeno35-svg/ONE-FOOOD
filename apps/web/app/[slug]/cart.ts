import type { MenuProductView } from '@onefood/shared';

export interface CartLine {
  key: string;
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  optionIds: string[];
  optionNames: string[];
  notes: string;
}

export function lineFrom(product: MenuProductView, optionIds: string[], quantity: number, notes: string): CartLine {
  const options = product.optionGroups
    .flatMap((group) => group.options)
    .filter((option) => optionIds.includes(option.id));
  return {
    key: crypto.randomUUID(),
    productId: product.id,
    name: product.name,
    unitPriceCents: product.priceCents + options.reduce((sum, option) => sum + option.priceDeltaCents, 0),
    quantity,
    optionIds: options.map((option) => option.id),
    optionNames: options.map((option) => option.name),
    notes: notes.trim(),
  };
}

export function subtotalOf(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

export function countOf(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/** O carrinho sobrevive a um recarregamento da página. Se o navegador bloquear, segue só em memória. */
export function loadCart(slug: string): CartLine[] {
  try {
    const raw = localStorage.getItem(`onefood:cart:${slug}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function saveCart(slug: string, lines: CartLine[]): void {
  try {
    localStorage.setItem(`onefood:cart:${slug}`, JSON.stringify(lines));
  } catch {
    // Sem armazenamento: o carrinho vale só enquanto a página estiver aberta.
  }
}
