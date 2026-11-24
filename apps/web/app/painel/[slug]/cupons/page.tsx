'use client';

import { type CouponView, createCouponSchema, formatBRL, parseBRL } from '@onefood/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { IconCoupon, IconPlus } from '../../../../components/icons';
import { api, errorMessage } from '../../../../lib/api';
import { usePanelStore } from '../store-context';

/** "10% de desconto, até R$ 20,00, em pedidos a partir de R$ 50,00" */
function describe(coupon: CouponView): string {
  const parts = [coupon.kind === 'percent' ? `${coupon.value}% de desconto` : `${formatBRL(coupon.value)} de desconto`];
  if (coupon.maxDiscountCents) parts.push(`até ${formatBRL(coupon.maxDiscountCents)}`);
  if (coupon.minOrderCents > 0) parts.push(`em pedidos a partir de ${formatBRL(coupon.minOrderCents)}`);
  return parts.join(', ');
}

function limits(coupon: CouponView): string {
  const parts = [
    coupon.maxRedemptions
      ? `${coupon.redemptions} de ${coupon.maxRedemptions} usos`
      : `${coupon.redemptions} ${coupon.redemptions === 1 ? 'uso' : 'usos'}`,
  ];
  if (coupon.oncePerCustomer) parts.push('um por cliente');
  if (coupon.endsAt) parts.push(`até ${new Date(coupon.endsAt).toLocaleDateString('pt-BR')}`);
  return parts.join(' · ');
}

export default function CouponsPage() {
  const store = usePanelStore();
  const base = `/v1/panel/stores/${store.slug}/coupons`;
  const [coupons, setCoupons] = useState<CouponView[] | null>(null);
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCoupons(await api<CouponView[]>(base));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (coupon: CouponView) => {
    try {
      await api(`${base}/${coupon.id}`, { method: 'PATCH', body: { active: !coupon.active } });
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const text = (name: string) => String(form.get(name) ?? '').trim();
    const money = (name: string): number | null | undefined => (text(name) ? parseBRL(text(name)) : undefined);

    const value = kind === 'percent' ? Number.parseInt(text('value'), 10) : parseBRL(text('value'));
    const minOrderCents = money('minOrder');
    const maxDiscountCents = money('maxDiscount');
    if (value === null || Number.isNaN(value) || minOrderCents === null || maxDiscountCents === null) {
      setError('Confira os valores: use números como 10 ou 15,00.');
      return;
    }
    // O cupom vale até o fim do dia escolhido, no horário de quem está criando.
    const endsAt = text('endsAt') ? new Date(`${text('endsAt')}T23:59:59`).toISOString() : null;
    const parsed = createCouponSchema.safeParse({
      code: text('code'),
      kind,
      value,
      minOrderCents: minOrderCents ?? 0,
      maxDiscountCents: kind === 'percent' ? (maxDiscountCents ?? null) : null,
      endsAt,
      maxRedemptions: text('maxRedemptions') ? Number.parseInt(text('maxRedemptions'), 10) : null,
      oncePerCustomer: form.get('oncePerCustomer') === 'on',
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.path[0] === 'code' ? `Código: ${issue.message}.` : `Confira os dados: ${issue?.message ?? ''}.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api(base, { method: 'POST', body: parsed.data });
      formElement.reset();
      setKind('percent');
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setSaving(false);
  };

  return (
    <main>
      <h1>Cupons</h1>
      <p className="muted">O desconto vale sobre os itens do pedido. A taxa de entrega não entra.</p>

      {coupons === null ? (
        <p className="muted" style={{ marginTop: 24 }}>
          Carregando.
        </p>
      ) : coupons.length === 0 ? (
        <p className="empty" style={{ marginTop: 24 }}>
          Nenhum cupom ainda. Crie o primeiro abaixo.
        </p>
      ) : (
        <ul className="list" style={{ marginTop: 24 }}>
          {coupons.map((coupon) => (
            <li key={coupon.id} className="line">
              <span className="row" style={{ gap: 8 }}>
                <IconCoupon />
                <strong>{coupon.code}</strong>
                {coupon.active ? null : <span className="tag tag-quiet">Desligado</span>}
              </span>
              {store.canEdit ? (
                <button type="button" className="btn btn-small" onClick={() => toggle(coupon)}>
                  {coupon.active ? 'Desligar' : 'Ligar'}
                </button>
              ) : (
                <span />
              )}
              <span className="muted product-detail">{describe(coupon)}</span>
              <span className="muted product-detail">{limits(coupon)}</span>
            </li>
          ))}
        </ul>
      )}

      {store.canEdit ? (
        <form className="card stack" onSubmit={create} style={{ marginTop: 32 }}>
          <h3>Novo cupom</h3>
          <label className="field">
            <span>Código</span>
            <input
              name="code"
              required
              maxLength={24}
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="BEMVINDO10"
            />
            <small>De 3 a 20 letras e números, sem espaços.</small>
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Tipo</span>
              <select value={kind} onChange={(event) => setKind(event.target.value as 'percent' | 'fixed')}>
                <option value="percent">Porcentagem</option>
                <option value="fixed">Valor fixo</option>
              </select>
            </label>
            <label className="field">
              <span>{kind === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'}</span>
              <input name="value" required inputMode="decimal" placeholder={kind === 'percent' ? '10' : '15,00'} />
            </label>
          </div>
          <div className="grid-2">
            <label className="field">
              <span>Pedido mínimo (R$)</span>
              <input name="minOrder" inputMode="decimal" placeholder="Sem mínimo" />
            </label>
            {kind === 'percent' ? (
              <label className="field">
                <span>Desconto máximo (R$)</span>
                <input name="maxDiscount" inputMode="decimal" placeholder="Sem teto" />
              </label>
            ) : (
              <span />
            )}
          </div>
          <div className="grid-2">
            <label className="field">
              <span>Válido até</span>
              <input name="endsAt" type="date" />
            </label>
            <label className="field">
              <span>Limite de usos</span>
              <input name="maxRedemptions" inputMode="numeric" placeholder="Sem limite" />
            </label>
          </div>
          <label className="choice">
            <input name="oncePerCustomer" type="checkbox" defaultChecked />
            <span>Cada cliente usa uma vez só</span>
          </label>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <IconPlus />
            {saving ? 'Criando' : 'Criar cupom'}
          </button>
        </form>
      ) : null}
    </main>
  );
}
