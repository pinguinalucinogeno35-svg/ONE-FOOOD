'use client';

import {
  allowedTransitions,
  type CourierView,
  formatBRL,
  formatPhoneBR,
  type OrderStatus,
  type PanelOrderView,
  type RealtimeMessage,
} from '@onefood/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  IconAlert,
  IconClock,
  IconClose,
  IconCoupon,
  IconDelivery,
  IconLive,
  IconPickup,
  IconPrinter,
} from '../../../../components/icons';
import { PrintTickets } from '../../../../components/print-tickets';
import { ApiError, api, errorMessage } from '../../../../lib/api';
import {
  ACTION_LABEL,
  FULFILLMENT_LABEL,
  minutesSince,
  PAYMENT_LABEL,
  STATUS_LABEL,
  timeOf,
} from '../../../../lib/labels';
import {
  DEFAULT_PRINT_SETTINGS,
  loadPrintSettings,
  type PrintSettings,
  savePrintSettings,
} from '../../../../lib/print-settings';
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
  const [couriers, setCouriers] = useState<CourierView[]>([]);
  // Impressão: o que está na bandeja, os ajustes deste aparelho e o que já foi mandado imprimir.
  const [tickets, setTickets] = useState<PanelOrderView[]>([]);
  const [printSettings, setPrintSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  const settingsRef = useRef(printSettings);
  settingsRef.current = printSettings;
  const sentToPrinter = useRef(new Set<string>());
  const printDialog = useRef<HTMLDialogElement>(null);

  const base = `/v1/panel/stores/${store.slug}`;

  /**
   * Manda os pedidos para a impressora, todos em um só trabalho de impressão, e avisa o
   * servidor. As vias ficam montadas fora da tela até a próxima impressão.
   */
  const print = useCallback(
    (toPrint: PanelOrderView[]) => {
      if (toPrint.length === 0) return;
      for (const order of toPrint) sentToPrinter.current.add(order.id);
      // As vias precisam estar na página antes de abrir a impressão.
      flushSync(() => setTickets(toPrint));
      window.print();
      for (const order of toPrint) {
        api(`${base}/orders/${order.id}/printed`, { method: 'POST' }).catch(() => undefined);
      }
      setOrders((current) =>
        current
          ? current.map((order) =>
              toPrint.some((printed) => printed.id === order.id) && !order.printedAt
                ? { ...order, printedAt: new Date().toISOString() }
                : order,
            )
          : current,
      );
    },
    [base],
  );

  useEffect(() => {
    setPrintSettings(loadPrintSettings());
  }, []);

  const changePrintSettings = (patch: Partial<PrintSettings>) => {
    const next = { ...printSettings, ...patch };
    setPrintSettings(next);
    savePrintSettings(next);
  };

  const refresh = useCallback(async () => {
    try {
      const open = await api<PanelOrderView[]>(`${base}/orders?scope=open`);
      setOrders(open);
      // Impressão automática: pedido novo que ainda não saiu em nenhuma impressora.
      const settings = settingsRef.current;
      if (settings.auto && (settings.kitchen || settings.customer)) {
        print(
          open.filter(
            (order) => order.status === 'pending' && !order.printedAt && !sentToPrinter.current.has(order.id),
          ),
        );
      }
      if (showClosed.current) setClosed(await api<PanelOrderView[]>(`${base}/orders?scope=recent`));
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setNow(Date.now());
  }, [base, print]);

  // Ligar a impressão automática já imprime o que estava esperando.
  useEffect(() => {
    if (printSettings.auto) void refresh();
  }, [printSettings.auto, refresh]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    api<CourierView[]>(`${base}/couriers`).then(
      (list) => setCouriers(list.filter((courier) => courier.active)),
      () => undefined,
    );
  }, [base]);

  const assign = async (order: PanelOrderView, courierId: string | null) => {
    setBusy(order.id);
    try {
      await api(`${base}/orders/${order.id}/courier`, { method: 'POST', body: { courierId } });
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
    await refresh();
  };

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
        <span className="row">
          <button type="button" className="btn btn-small" onClick={() => printDialog.current?.showModal()}>
            <IconPrinter />
            Impressão
          </button>
          <span className={live ? 'tag tag-good' : 'tag tag-quiet'}>
            <IconLive width={16} height={16} />
            {live ? 'Ao vivo' : 'Reconectando'}
          </span>
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
                    <OrderCard
                      key={order.id}
                      order={order}
                      now={now}
                      busy={busy === order.id}
                      couriers={couriers}
                      onMove={move}
                      onAssign={assign}
                      onPrint={(target) => print([target])}
                    />
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

      <dialog ref={printDialog} aria-labelledby="print-title">
        <div className="dialog-body">
          <div className="row between">
            <h3 id="print-title">Impressão neste aparelho</h3>
            <button
              type="button"
              className="btn btn-quiet btn-icon"
              aria-label="Fechar"
              onClick={() => printDialog.current?.close()}
            >
              <IconClose />
            </button>
          </div>
          <p className="muted">
            Vale para a impressora instalada neste computador. Cada aparelho guarda os próprios ajustes.
          </p>
          <fieldset>
            <legend>O que imprimir</legend>
            <label className="choice">
              <input
                type="checkbox"
                checked={printSettings.kitchen}
                onChange={(event) => changePrintSettings({ kitchen: event.target.checked })}
              />
              <span>Via da cozinha</span>
            </label>
            <label className="choice">
              <input
                type="checkbox"
                checked={printSettings.customer}
                onChange={(event) => changePrintSettings({ customer: event.target.checked })}
              />
              <span>Via do cliente</span>
            </label>
          </fieldset>
          <label className="field">
            <span>Largura do papel</span>
            <select
              value={printSettings.paper}
              onChange={(event) => changePrintSettings({ paper: event.target.value === '58' ? '58' : '80' })}
            >
              <option value="80">80 mm</option>
              <option value="58">58 mm</option>
            </select>
          </label>
          <label className="choice">
            <input
              type="checkbox"
              checked={printSettings.auto}
              onChange={(event) => changePrintSettings({ auto: event.target.checked })}
            />
            <span>Imprimir sozinho quando chega um pedido novo</span>
          </label>
          <p className="muted">
            O navegador mostra a janela de impressão a cada pedido. Para imprimir direto, sem a janela, abra o Chrome
            com a opção de impressão silenciosa (--kiosk-printing) e deixe a impressora térmica como padrão.
          </p>
        </div>
      </dialog>

      <PrintTickets orders={tickets} storeName={store.name} settings={printSettings} />
    </main>
  );
}

function OrderCard({
  order,
  now,
  busy,
  couriers,
  onMove,
  onAssign,
  onPrint,
}: {
  order: PanelOrderView;
  now: number;
  busy: boolean;
  couriers: CourierView[];
  onMove: (order: PanelOrderView, status: OrderStatus) => void;
  onAssign: (order: PanelOrderView, courierId: string | null) => void;
  onPrint: (order: PanelOrderView) => void;
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
      {order.fulfillment === 'delivery' ? (
        <label className="field">
          <span>Entregador</span>
          <select
            aria-label={`Entregador do pedido ${order.number}`}
            value={order.courier?.id ?? ''}
            disabled={busy}
            onChange={(event) => onAssign(order, event.target.value || null)}
          >
            <option value="">Sem entregador</option>
            {/* Entregador desligado depois de atribuído continua aparecendo neste pedido. */}
            {order.courier && !couriers.some((courier) => courier.id === order.courier?.id) ? (
              <option value={order.courier.id}>{order.courier.name}</option>
            ) : null}
            {couriers.map((courier) => (
              <option key={courier.id} value={courier.id}>
                {courier.name}
              </option>
            ))}
          </select>
        </label>
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
      <div className="row between">
        <span className="muted">
          {order.printedAt ? `Impresso às ${timeOf(order.printedAt)}` : 'Ainda não impresso'}
        </span>
        <button type="button" className="btn btn-small" onClick={() => onPrint(order)}>
          <IconPrinter width={16} height={16} />
          {order.printedAt ? 'Reimprimir' : 'Imprimir'}
        </button>
      </div>
    </article>
  );
}
