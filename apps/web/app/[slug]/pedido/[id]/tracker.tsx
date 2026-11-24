'use client';

import { formatBRL, isOpenStatus, type OrderStatus, type TrackedOrderView } from '@onefood/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CourierMap } from '../../../../components/courier-map';
import { IconBack, IconDelivery, IconDone } from '../../../../components/icons';
import { ApiError, api, errorMessage } from '../../../../lib/api';
import { PAYMENT_LABEL, STATUS_LABEL, timeOf } from '../../../../lib/labels';
import { ReviewForm } from './review-form';

const POLL_MS = 10_000;

function stepsFor(order: TrackedOrderView): OrderStatus[] {
  return order.fulfillment === 'delivery'
    ? ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed']
    : ['pending', 'confirmed', 'preparing', 'ready', 'completed'];
}

export function OrderTracker({ slug, orderId }: { slug: string; orderId: string }) {
  const [order, setOrder] = useState<TrackedOrderView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const current = await api<TrackedOrderView>(`/v1/stores/${slug}/orders/${orderId}`);
        if (!active) return;
        setOrder(current);
        setError(null);
        // Pedido encerrado não muda mais: para de consultar.
        if (isOpenStatus(current.status)) timer = setTimeout(load, POLL_MS);
      } catch (failure) {
        if (!active) return;
        setError(errorMessage(failure));
        if (!(failure instanceof ApiError && failure.status === 404)) timer = setTimeout(load, POLL_MS);
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [slug, orderId]);

  if (!order) {
    return (
      <main>
        <h1>Seu pedido</h1>
        <p className={error ? 'error' : 'muted'} role={error ? 'alert' : undefined}>
          {error ?? 'Carregando.'}
        </p>
      </main>
    );
  }

  const steps = stepsFor(order);
  const position = steps.indexOf(order.status);

  return (
    <main>
      <h1>Pedido {order.number}</h1>
      <p className="muted">Feito às {timeOf(order.createdAt)}. Esta página se atualiza sozinha.</p>

      <section className="card" style={{ marginTop: 16 }} aria-live="polite">
        {order.status === 'cancelled' ? (
          <p className="error" style={{ fontWeight: 700 }}>
            Este pedido foi cancelado pela loja.
          </p>
        ) : (
          <ol className="steps">
            {steps.map((step, index) => {
              const state = index < position ? 'done' : index === position ? 'current' : 'todo';
              return (
                <li key={step} className="step" data-state={state}>
                  {state === 'done' ? <IconDone /> : <span className="dot" />}
                  {STATUS_LABEL[step]}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {order.courier ? (
        <section className="card stack" style={{ marginTop: 16 }} aria-label="Entregador">
          <p className="row" style={{ gap: 8 }}>
            <IconDelivery />
            <strong>
              {order.status === 'out_for_delivery'
                ? `${order.courier.name} está a caminho`
                : `${order.courier.name} vai levar o seu pedido`}
            </strong>
          </p>
          {order.courier.position ? (
            <>
              <CourierMap position={order.courier.position} label={`Mapa com a posição de ${order.courier.name}`} />
              <p className="muted">Posição atualizada às {timeOf(order.courier.position.recordedAt)}.</p>
            </>
          ) : null}
        </section>
      ) : null}

      {order.status === 'completed' ? (
        <ReviewForm slug={slug} order={order} onReviewed={(review) => setOrder({ ...order, review })} />
      ) : null}

      <h2>Itens</h2>
      <ul className="list">
        {order.items.map((item) => (
          <li key={item.lineNo} className="line">
            <span className="product-name">
              {item.quantity} x {item.productName}
            </span>
            <span className="tabular">{formatBRL(item.totalCents)}</span>
            <span className="muted product-detail">
              {[...item.options.map((option) => option.name), item.notes].filter(Boolean).join(', ')}
            </span>
          </li>
        ))}
      </ul>

      <div className="card totals" style={{ marginTop: 16 }}>
        <div>
          <span>Itens</span>
          <span className="tabular">{formatBRL(order.subtotalCents)}</span>
        </div>
        {order.fulfillment === 'delivery' ? (
          <div>
            <span>Entrega</span>
            <span className="tabular">{order.deliveryFeeCents > 0 ? formatBRL(order.deliveryFeeCents) : 'Grátis'}</span>
          </div>
        ) : null}
        {order.discountCents > 0 ? (
          <div>
            <span>Desconto{order.couponCode ? ` (${order.couponCode})` : ''}</span>
            <span className="tabular">{formatBRL(-order.discountCents)}</span>
          </div>
        ) : null}
        <div className="total">
          <span>Total</span>
          <span className="tabular">{formatBRL(order.totalCents)}</span>
        </div>
        <p className="muted">Pagamento: {PAYMENT_LABEL[order.paymentMethod]}</p>
      </div>

      <Link className="btn btn-quiet" href={`/${slug}`} style={{ marginTop: 16, marginLeft: -16 }}>
        <IconBack />
        Voltar ao cardápio
      </Link>
    </main>
  );
}
