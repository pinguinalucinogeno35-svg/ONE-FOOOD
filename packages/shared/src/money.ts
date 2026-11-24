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
