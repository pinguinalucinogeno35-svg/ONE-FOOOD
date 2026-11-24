import { describe, expect, it } from 'vitest';
import { couponCodeSchema, couponDiscount } from './coupons.js';
import { assertCents, formatBRL, multiplyCents, parseBRL, sumCents } from './money.js';
import { formatPhoneBR, toE164BR } from './phone.js';

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

describe('valor digitado em reais', () => {
  it('aceita os formatos que as pessoas digitam', () => {
    expect(parseBRL('45')).toBe(4500);
    expect(parseBRL('45,5')).toBe(4550);
    expect(parseBRL('45,50')).toBe(4550);
    expect(parseBRL('0,05')).toBe(5);
    expect(parseBRL('1.234,56')).toBe(123456);
    expect(parseBRL(' R$ 7,00 ')).toBe(700);
    expect(parseBRL('0')).toBe(0);
  });

  it('recusa o que não é um valor', () => {
    for (const input of ['', 'abc', '-5', '4,555', '4.5', '1,2,3', '12.34,00', '1e3']) {
      expect(parseBRL(input), input).toBeNull();
    }
  });
});

describe('telefone brasileiro', () => {
  it('converte para E.164', () => {
    expect(toE164BR('(11) 99999-0000')).toBe('+5511999990000');
    expect(toE164BR('11 3333 4444')).toBe('+551133334444');
    expect(toE164BR('+55 11 99999-0000')).toBe('+5511999990000');
    expect(toE164BR('011 99999-0000')).toBe('+5511999990000');
  });

  it('recusa número incompleto ou sem DDD válido', () => {
    for (const input of ['', '99999-0000', '(01) 99999-0000', '(11) 89999-0000', '123', '(11) 99999-00000']) {
      expect(toE164BR(input), input).toBeNull();
    }
  });

  it('formata para exibição', () => {
    expect(formatPhoneBR('+5511999990000')).toBe('(11) 99999-0000');
    expect(formatPhoneBR('+551133334444')).toBe('(11) 3333-4444');
  });
});

describe('desconto de cupom', () => {
  it('percentual arredonda para baixo e respeita o teto', () => {
    expect(couponDiscount({ kind: 'percent', value: 10, maxDiscountCents: null }, 3333)).toBe(333);
    expect(couponDiscount({ kind: 'percent', value: 50, maxDiscountCents: 1000 }, 5000)).toBe(1000);
    expect(couponDiscount({ kind: 'percent', value: 100, maxDiscountCents: null }, 4200)).toBe(4200);
  });

  it('valor fixo nunca passa do valor dos itens', () => {
    expect(couponDiscount({ kind: 'fixed', value: 1500, maxDiscountCents: null }, 5000)).toBe(1500);
    expect(couponDiscount({ kind: 'fixed', value: 1500, maxDiscountCents: null }, 900)).toBe(900);
  });

  it('normaliza o código digitado', () => {
    expect(couponCodeSchema.parse(' bem vindo10 ')).toBe('BEMVINDO10');
    expect(couponCodeSchema.safeParse('ab').success).toBe(false);
    expect(couponCodeSchema.safeParse('com-traço').success).toBe(false);
  });
});
