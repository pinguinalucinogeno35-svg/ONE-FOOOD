import { describe, expect, it } from 'vitest';
import { assertCents, formatBRL, multiplyCents, sumCents } from './money.js';

describe('dinheiro em centavos', () => {
  it('formata em reais', () => {
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(1990)).toBe('R$ 19,90');
    expect(formatBRL(123456789)).toBe('R$ 1.234.567,89');
    expect(formatBRL(-250)).toBe('-R$ 2,50');
  });

  it('recusa valores que não são inteiros', () => {
    expect(() => assertCents(19.9)).toThrow(RangeError);
    expect(() => assertCents(Number.NaN)).toThrow(RangeError);
    expect(() => sumCents([100, 0.5])).toThrow(RangeError);
  });

  it('soma e multiplica sem erro de arredondamento', () => {
    expect(sumCents([10, 20])).toBe(30);
    expect(multiplyCents(1990, 3)).toBe(5970);
    expect(() => multiplyCents(1990, 1.5)).toThrow(RangeError);
    expect(() => multiplyCents(1990, -1)).toThrow(RangeError);
  });
});
