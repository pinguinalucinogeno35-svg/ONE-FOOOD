/**
 * Dinheiro é sempre um inteiro em centavos. Nunca use ponto flutuante para valores.
 */
export type Cents = number;

export function assertCents(value: number, label = 'valor'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} deve ser um inteiro em centavos, recebido: ${value}`);
  }
  return value;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) total += assertCents(value);
  return assertCents(total, 'soma');
}

export function multiplyCents(unit: Cents, quantity: number): Cents {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError(`quantidade inválida: ${quantity}`);
  }
  return assertCents(assertCents(unit) * quantity, 'produto');
}

/** 1990 -> "R$ 19,90" */
export function formatBRL(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavos = (abs % 100).toString().padStart(2, '0');
  return `${sign}R$ ${reais},${centavos}`;
}

/**
 * Lê um valor digitado em reais ("45", "45,5", "1.234,56", "R$ 7,00") e devolve centavos.
 * Devolve null se não for um valor válido. Ponto é separador de milhar; vírgula, de centavos.
 */
export function parseBRL(input: string): Cents | null {
  const cleaned = input.replace(/R\$/i, '').replace(/\s/g, '');
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const reais = Number((match[1] as string).replace(/\./g, ''));
  const centavos = Number((match[2] ?? '0').padEnd(2, '0'));
  const total = reais * 100 + centavos;
  return Number.isSafeInteger(total) ? total : null;
}
