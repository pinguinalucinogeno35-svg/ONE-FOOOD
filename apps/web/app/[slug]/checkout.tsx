'use client';

import {
  type CouponPreview,
  type CreateOrderInput,
  type Fulfillment,
  formatBRL,
  type MenuView,
  type OrderView,
  type PaymentMethod,
  toE164BR,
} from '@onefood/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { IconBack, IconClose, IconCoupon, IconDelivery, IconMinus, IconPickup, IconPlus } from '../../components/icons';
import { api, errorMessage } from '../../lib/api';
import { type CartLine, subtotalOf } from './cart';

interface Props {
  menu: MenuView;
  lines: CartLine[];
  onChange: (lines: CartLine[]) => void;
  onBack: () => void;
  onPlaced: () => void;
}

export function Checkout({ menu, lines, onChange, onBack, onPlaced }: Props) {
  const router = useRouter();
  const [fulfillment, setFulfillment] = useState<Fulfillment>('delivery');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [coupon, setCoupon] = useState<CouponPreview | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  // A chave acompanha o conteúdo do pedido: reenviar o mesmo pedido depois de uma falha de rede
  // usa a mesma chave e não cria dois; mudar qualquer coisa gera uma chave nova.
  const attempt = useRef<{ body: string; key: string } | null>(null);

  const setQuantity = (key: string, quantity: number) => {
    onChange(
      quantity <= 0
        ? lines.filter((line) => line.key !== key)
        : lines.map((line) => (line.key === key ? { ...line, quantity: Math.min(99, quantity) } : line)),
    );
  };

  const subtotal = subtotalOf(lines);
  const deliveryFee = fulfillment === 'delivery' ? menu.store.deliveryFeeCents : 0;
  const discount = coupon?.discountCents ?? 0;
  const couponCode = coupon?.code;

  const applyCoupon = async (code: string) => {
    try {
      setCoupon(
        await api<CouponPreview>(`/v1/stores/${menu.store.slug}/coupons/preview`, {
          method: 'POST',
          body: { code, subtotalCents: subtotal },
        }),
      );
      setCouponInput('');
      setCouponError(null);
    } catch (failure) {
      setCoupon(null);
      setCouponError(errorMessage(failure));
    }
  };

  // O desconto depende do valor dos itens: quando o carrinho muda, o cupom é conferido de novo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só o subtotal dispara a nova conferência.
  useEffect(() => {
    if (couponCode) void applyCoupon(couponCode);
  }, [subtotal]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();

    const phone = toE164BR(text('phone'));
    if (!phone) {
      setError('Confira o telefone: informe o DDD e o número.');
      return;
    }
    const postalCode = text('postalCode').replace(/\D/g, '');
    if (fulfillment === 'delivery' && postalCode.length !== 8) {
      setError('Confira o CEP: são 8 números.');
      return;
    }

    const input: CreateOrderInput = {
      customer: { name: text('name'), phone },
      fulfillment,
      paymentMethod,
      items: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        optionIds: line.optionIds,
        notes: line.notes || undefined,
      })),
      deliveryAddress:
        fulfillment === 'delivery'
          ? {
              street: text('street'),
              number: text('number'),
              complement: text('complement') || undefined,
              district: text('district'),
              city: text('city'),
              state: text('state').toUpperCase(),
              postalCode,
            }
          : undefined,
      notes: text('notes') || undefined,
      couponCode,
    };

    const body = JSON.stringify(input);
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };

    setSending(true);
    setError(null);
    try {
      const order = await api<OrderView>(`/v1/stores/${menu.store.slug}/orders`, {
        method: 'POST',
        body: input,
        headers: { 'idempotency-key': attempt.current.key },
      });
      onPlaced();
      router.push(`/${menu.store.slug}/pedido/${order.id}`);
    } catch (failure) {
      setError(errorMessage(failure));
      setSending(false);
    }
  };

  return (
    <main>
      <button type="button" className="btn btn-quiet" onClick={onBack} style={{ marginLeft: -16 }}>
        <IconBack />
        Voltar ao cardápio
      </button>
      <h1>Seu pedido</h1>
      <p className="muted">{menu.store.name}</p>

      {lines.length === 0 ? (
        <p className="empty" style={{ marginTop: 24 }}>
          Seu carrinho está vazio.
        </p>
      ) : (
        <form className="stack" onSubmit={submit} style={{ marginTop: 16 }}>
          <ul className="list">
            {lines.map((line) => (
              <li key={line.key} className="line">
                <span className="product-name">{line.name}</span>
                <span className="tabular">{formatBRL(line.unitPriceCents * line.quantity)}</span>
                <span className="muted">{[...line.optionNames, line.notes].filter(Boolean).join(', ')}</span>
                <span className="stepper">
                  <button
                    type="button"
                    className="btn btn-small btn-icon"
                    onClick={() => setQuantity(line.key, line.quantity - 1)}
                    aria-label={`Diminuir ${line.name}`}
                  >
                    <IconMinus />
                  </button>
                  <output>{line.quantity}</output>
                  <button
                    type="button"
                    className="btn btn-small btn-icon"
                    onClick={() => setQuantity(line.key, line.quantity + 1)}
                    aria-label={`Aumentar ${line.name}`}
                  >
                    <IconPlus />
                  </button>
                </span>
              </li>
            ))}
          </ul>

          <fieldset>
            <legend>Como você quer receber?</legend>
            <label className="choice">
              <input
                type="radio"
                name="fulfillment"
                checked={fulfillment === 'delivery'}
                onChange={() => setFulfillment('delivery')}
              />
              <span>Entrega</span>
              <IconDelivery />
            </label>
            <label className="choice">
              <input
                type="radio"
                name="fulfillment"
                checked={fulfillment === 'pickup'}
                onChange={() => setFulfillment('pickup')}
              />
              <span>Retirar na loja</span>
              <IconPickup />
            </label>
          </fieldset>

          <label className="field">
            <span>Seu nome</span>
            <input name="name" required maxLength={120} autoComplete="name" />
          </label>
          <label className="field">
            <span>Telefone com DDD</span>
            <input name="phone" required type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-0000" />
            <small>Usado só para falar com você sobre este pedido.</small>
          </label>

          {fulfillment === 'delivery' ? (
            <>
              <label className="field">
                <span>CEP</span>
                <input
                  name="postalCode"
                  required
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="00000-000"
                />
              </label>
              <div className="grid-2">
                <label className="field">
                  <span>Rua</span>
                  <input name="street" required maxLength={200} autoComplete="address-line1" />
                </label>
                <label className="field">
                  <span>Número</span>
                  <input name="number" required maxLength={20} />
                </label>
              </div>
              <label className="field">
                <span>Complemento</span>
                <input name="complement" maxLength={100} placeholder="Apto, bloco, referência" />
              </label>
              <label className="field">
                <span>Bairro</span>
                <input name="district" required maxLength={100} />
              </label>
              <div className="grid-2">
                <label className="field">
                  <span>Cidade</span>
                  <input name="city" required maxLength={100} autoComplete="address-level2" />
                </label>
                <label className="field">
                  <span>UF</span>
                  <input
                    name="state"
                    required
                    minLength={2}
                    maxLength={2}
                    autoComplete="address-level1"
                    placeholder="SP"
                  />
                </label>
              </div>
            </>
          ) : null}

          <fieldset>
            <legend>Pagamento na {fulfillment === 'delivery' ? 'entrega' : 'retirada'}</legend>
            <label className="choice">
              <input
                type="radio"
                name="payment"
                checked={paymentMethod === 'cash'}
                onChange={() => setPaymentMethod('cash')}
              />
              <span>Dinheiro</span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name="payment"
                checked={paymentMethod === 'card_on_delivery'}
                onChange={() => setPaymentMethod('card_on_delivery')}
              />
              <span>Cartão</span>
            </label>
          </fieldset>

          <label className="field">
            <span>Observação para a loja</span>
            <input name="notes" maxLength={500} placeholder="Ex.: troco para 100" />
          </label>

          {coupon ? (
            <p className="applied">
              <span className="row" style={{ gap: 8 }}>
                <IconCoupon />
                Cupom {coupon.code} aplicado
              </span>
              <button
                type="button"
                className="btn btn-small btn-quiet btn-icon"
                aria-label="Remover cupom"
                onClick={() => setCoupon(null)}
              >
                <IconClose />
              </button>
            </p>
          ) : (
            <div className="field">
              <label htmlFor="coupon" style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                Cupom de desconto
              </label>
              <div className="inline-form">
                <input
                  id="coupon"
                  value={couponInput}
                  maxLength={24}
                  autoCapitalize="characters"
                  spellCheck={false}
                  onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    // Enter aqui aplica o cupom, em vez de enviar o pedido.
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (couponInput.trim()) void applyCoupon(couponInput);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={!couponInput.trim()}
                  onClick={() => applyCoupon(couponInput)}
                >
                  Aplicar
                </button>
              </div>
              {couponError ? (
                <small className="error" role="status">
                  {couponError}
                </small>
              ) : null}
            </div>
          )}

          <div className="card totals">
            <div>
              <span>Itens</span>
              <span className="tabular">{formatBRL(subtotal)}</span>
            </div>
            {fulfillment === 'delivery' ? (
              <div>
                <span>Entrega</span>
                <span className="tabular">{deliveryFee > 0 ? formatBRL(deliveryFee) : 'Grátis'}</span>
              </div>
            ) : null}
            {discount > 0 ? (
              <div>
                <span>Desconto</span>
                <span className="tabular">{formatBRL(-discount)}</span>
              </div>
            ) : null}
            <div className="total">
              <span>Total</span>
              <span className="tabular">{formatBRL(subtotal + deliveryFee - discount)}</span>
            </div>
          </div>

          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary btn-block" disabled={sending}>
            {sending ? 'Enviando pedido' : 'Fazer pedido'}
          </button>
        </form>
      )}
    </main>
  );
}
