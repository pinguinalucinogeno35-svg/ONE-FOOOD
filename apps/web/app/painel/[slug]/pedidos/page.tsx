'use client';

import {
  allowedTransitions,
  formatBRL,
  formatPhoneBR,
  type OrderStatus,
  type PanelOrderView,
  type RealtimeMessage,
} from '@onefood/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconAlert,
  IconClock,
  IconClose,
  IconCoupon,
  IconDelivery,
  IconLive,
  IconPickup,
} from '../../../../components/icons';
import { ApiError, api, errorMessage } from '../../../../lib/api';
import {
  ACTION_LABEL,
  FULFILLMENT_LABEL,
  minutesSince,
  PAYMENT_LABEL,
  STATUS_LABEL,
  timeOf,
} from '../../../../lib/labels';
import { usePanelStore } from '../store-context';

const COLUMNS: Array<{ title: string; statuses: OrderStatus[] }> = [
  { title: 'Novos', statuses: ['pending'] },
  { title: 'Em preparo', statuses: ['confirmed', 'preparing'] },
  { title: 'Prontos', statuses: ['ready'] },
  { title: 'Em entrega', statuses: ['out_for_delivery'] },
];
/** Rede de segurança: mesmo com a conexão ao vivo, a lista é relida de tempos em tempos. */
const REFRESH_MS = 30_000;
const LATE_AFTER_MINUTES = 40;

export default function OrdersPage() {
  const store = usePanelStore();
  const [orders, setOrders] = useState<PanelOrderView[] | null>(null);
  const [closed, setClosed] = useState<PanelOrderView[] | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Notas baixas que chegaram enquanto o painel estava aberto.
  const [lowRatings, setLowRatings] = useState<Array<{ orderId: string; number: number; rating: number }>>([]);
  const showClosed = useRef(false);

  const base = `/v1/panel/stores/${store.slug}`;

  const refresh = useCallback(async () => {
    try {
      setOrders(await api<PanelOrderView[]>(`${base}/orders?scope=open`));
      if (showClosed.current) setClosed(await api<PanelOrderView[]>(`${base}/orders?scope=recent`));
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setNow(Date.now());
  }, [base]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Conexão ao vivo: a cada aviso do servidor, relê a lista. Se cair, tenta de novo com espera crescente.
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;

    const connect = async () => {
      try {
        const { token, url } = await api<{ token: string; url: string }>(`${base}/realtime-token`, { method: 'POST' });
        if (stopped) return;
        socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
        socket.onopen = () => {
          attempts = 0;
          setLive(true);
          void refresh();
        };
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data)) as RealtimeMessage;
            if (message.type === 'review.created') {
              const review = (message as RealtimeMessage<'review.created'>).data;
              if (review.low) {
                setLowRatings((current) =>
                  current.some((item) => item.orderId === review.orderId) ? current : [...current, review],
                );
              }
              return;
            }
          } catch {
            // Mensagem que não deu para ler: relê a lista do mesmo jeito.
          }
          void refresh();
        };
        socket.onclose = () => {
          setLive(false);
          schedule();
        };
        socket.onerror = () => socket?.close();
      } catch {
        schedule();
      }
    };
    const schedule = () => {
      if (stopped) return;
      attempts += 1;
      retry = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5)));
    };
    void connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [base, refresh]);

  const move = async (order: PanelOrderView, status: OrderStatus) => {
    if (status === 'cancelled' && !window.confirm(`Cancelar o pedido ${order.number}?`)) return;
    setBusy(order.id);
    try {
      await api(`${base}/orders/${order.id}/status`, { method: 'POST', body: { status } });
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
      if (!(failure instanceof ApiError)) return;
    } finally {
      setBusy(null);
    }
    await refresh();
  };

  const toggleClosed = async () => {
    showClosed.current = !showClosed.current;
    if (showClosed.current) await refresh();
    else setClosed(null);
  };

  return (
    <main className="wide">
      <div className="row between" style={{ marginBottom: 16 }}>
        <h1>Pedidos</h1>
        <span className={live ? 'tag tag-good' : 'tag tag-quiet'}>
          <IconLive width={16} height={16} />
          {live ? 'Ao vivo' : 'Reconectando'}
        </span>
      </div>
      {error ? (
        <p className="error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </p>
      ) : null}
      {lowRatings.map((review) => (
        <div key={review.orderId} className="banner" role="alert" style={{ marginBottom: 16 }}>
          <IconAlert />
          <span>
            Nota baixa no pedido {review.number}: {review.rating} de 5.{' '}
            <Link href={`/painel/${store.slug}/avaliacoes`}>Ver avaliações</Link>
          </span>
          <button
            type="button"
            className="btn btn-small btn-quiet btn-icon"
            aria-label={`Dispensar aviso do pedido ${review.number}`}
            onClick={() => setLowRatings((current) => current.filter((item) => item.orderId !== review.orderId))}
          >
            <IconClose />
          </button>
        </div>
      ))}

      {orders === null ? (
        <p className="muted">Carregando.</p>
      ) : (
        <div className="board">
          {COLUMNS.map((column) => {
            const inColumn = orders.filter((order) => column.statuses.includes(order.status));
            return (
              <section key={column.title} className="column" aria-label={column.title}>
                <h2>
                  <span>{column.title}</span>
                  <span>{inColumn.length}</span>
                </h2>
                <div className="stack">
                  {inColumn.length === 0 ? <p className="empty">Nenhum pedido.</p> : null}
                  {inColumn.map((order) => (
                    <OrderCard key={order.id} order={order} now={now} busy={busy === order.id} onMove={move} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 32 }}>
        <button type="button" className="btn btn-small" onClick={toggleClosed}>
          {closed ? 'Esconder encerrados' : 'Ver encerrados nas últimas 24 horas'}
        </button>
        {closed ? (
          closed.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              Nenhum pedido encerrado nas últimas 24 horas.
            </p>
          ) : (
            <ul className="list" style={{ marginTop: 12 }}>
              {closed.map((order) => (
                <li key={order.id} className="line">
                  <span>
                    <strong>Pedido {order.number}</strong> · {order.customer.name} · {timeOf(order.createdAt)}
                  </span>
                  <span className="tabular">{formatBRL(order.totalCents)}</span>
                  <span className="muted product-detail">{STATUS_LABEL[order.status]}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </main>
  );
}

function OrderCard({
  order,
  now,
  busy,
  onMove,
}: {
  order: PanelOrderView;
  now: number;
  busy: boolean;
  onMove: (order: PanelOrderView, status: OrderStatus) => void;
}) {
  const minutes = minutesSince(order.createdAt, now);
  const next = allowedTransitions(order.status, order.fulfillment).filter((status) => status !== 'cancelled')[0];
  const address = order.deliveryAddress;

  return (
    <article className="card order">
      <div className="row between">
        <h3>Pedido {order.number}</h3>
        <span className={minutes >= LATE_AFTER_MINUTES ? 'row late' : 'row muted'} style={{ gap: 4 }}>
          <IconClock width={16} height={16} />
          {minutes} min
        </span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="tag">
          {order.fulfillment === 'delivery' ? (
            <IconDelivery width={16} height={16} />
          ) : (
            <IconPickup width={16} height={16} />
          )}
          {FULFILLMENT_LABEL[order.fulfillment]}
        </span>
        {order.status === 'confirmed' || order.status === 'preparing' ? (
          <span className="tag tag-quiet">{STATUS_LABEL[order.status]}</span>
        ) : null}
      </div>

      <ul className="order-items">
        {order.items.map((item) => (
          <li key={item.lineNo}>
            <strong>
              {item.quantity} x {item.productName}
            </strong>
            {item.options.length > 0 ? (
              <div className="muted">{item.options.map((option) => option.name).join(', ')}</div>
            ) : null}
            {item.notes ? <div className="muted">Obs.: {item.notes}</div> : null}
          </li>
        ))}
      </ul>
      {order.notes ? <p className="muted">Obs. do pedido: {order.notes}</p> : null}

      <p className="muted">
        {order.customer.name} · <a href={`tel:${order.customer.phone}`}>{formatPhoneBR(order.customer.phone)}</a>
      </p>
      {address ? (
        <p className="muted">
          {address.street}, {address.number}
          {address.complement ? `, ${address.complement}` : ''} · {address.district}, {address.city}
        </p>
      ) : null}
      {order.couponCode ? (
        <p className="row muted" style={{ gap: 6 }}>
          <IconCoupon width={16} height={16} />
          Cupom {order.couponCode}: {formatBRL(-order.discountCents)}
        </p>
      ) : null}
      <p className="row between">
        <span className="muted">{PAYMENT_LABEL[order.paymentMethod]}</span>
        <strong className="tabular">{formatBRL(order.totalCents)}</strong>
      </p>

      <div className="row">
        {next ? (
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={busy}
            onClick={() => onMove(order, next)}
          >
            {ACTION_LABEL[next]}
          </button>
        ) : null}
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => onMove(order, 'cancelled')}>
          Cancelar
        </button>
      </div>
    </article>
  );
}
