'use client';

import { formatBRL, formatPhoneBR, type PanelOrderView } from '@onefood/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FULFILLMENT_LABEL } from '../lib/labels';
import type { PrintSettings } from '../lib/print-settings';

function when(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function paymentLine(order: PanelOrderView): string {
  if (order.paymentMethod === 'cash') return `Receber em dinheiro: ${formatBRL(order.totalCents)}`;
  if (order.paymentMethod === 'card_on_delivery') return `Receber no cartão: ${formatBRL(order.totalCents)}`;
  return `Pix: ${formatBRL(order.totalCents)}`;
}

/** Via da cozinha: o que preparar, em letra grande. Sem valores nem dados do cliente. */
function KitchenTicket({ order, storeName }: { order: PanelOrderView; storeName: string }) {
  return (
    <section className="ticket ticket-kitchen">
      <p className="ticket-small">{storeName} · cozinha</p>
      <p className="ticket-number">PEDIDO {order.number}</p>
      <p className="ticket-strong">
        {FULFILLMENT_LABEL[order.fulfillment].toUpperCase()} · {when(order.createdAt)}
      </p>
      <hr />
      {order.items.map((item) => (
        <div key={item.lineNo} className="ticket-item">
          <p className="ticket-big">
            {item.quantity} x {item.productName}
          </p>
          {item.options.map((option) => (
            <p key={option.optionId} className="ticket-indent">
              {option.name}
            </p>
          ))}
          {item.notes ? <p className="ticket-indent ticket-strong">OBS.: {item.notes}</p> : null}
        </div>
      ))}
      {order.notes ? (
        <>
          <hr />
          <p className="ticket-strong">OBS. DO PEDIDO: {order.notes}</p>
        </>
      ) : null}
    </section>
  );
}

/** Via do cliente: vai com o pedido. Valores, endereço e o que receber. */
function CustomerTicket({ order, storeName }: { order: PanelOrderView; storeName: string }) {
  const address = order.deliveryAddress;
  return (
    <section className="ticket ticket-customer">
      <p className="ticket-big ticket-center">{storeName}</p>
      <p className="ticket-center">
        Pedido {order.number} · {when(order.createdAt)}
      </p>
      <hr />
      <p className="ticket-strong">{order.customer.name}</p>
      <p>{formatPhoneBR(order.customer.phone)}</p>
      {address ? (
        <>
          <p>
            {address.street}, {address.number}
            {address.complement ? `, ${address.complement}` : ''}
          </p>
          <p>
            {address.district} · {address.city} - {address.state}
          </p>
          <p>CEP {address.postalCode.replace(/^(\d{5})(\d{3})$/, '$1-$2')}</p>
        </>
      ) : (
        <p className="ticket-strong">{FULFILLMENT_LABEL[order.fulfillment].toUpperCase()}</p>
      )}
      {order.courier ? <p>Entregador: {order.courier.name}</p> : null}
      <hr />
      {order.items.map((item) => (
        <div key={item.lineNo} className="ticket-item">
          <p className="ticket-row">
            <span>
              {item.quantity} x {item.productName}
            </span>
            <span>{formatBRL(item.totalCents)}</span>
          </p>
          {item.options.map((option) => (
            <p key={option.optionId} className="ticket-indent">
              {option.name}
            </p>
          ))}
          {item.notes ? <p className="ticket-indent">Obs.: {item.notes}</p> : null}
        </div>
      ))}
      <hr />
      <p className="ticket-row">
        <span>Itens</span>
        <span>{formatBRL(order.subtotalCents)}</span>
      </p>
      {order.fulfillment === 'delivery' ? (
        <p className="ticket-row">
          <span>Entrega</span>
          <span>{order.deliveryFeeCents > 0 ? formatBRL(order.deliveryFeeCents) : 'Grátis'}</span>
        </p>
      ) : null}
      {order.discountCents > 0 ? (
        <p className="ticket-row">
          <span>Desconto{order.couponCode ? ` (${order.couponCode})` : ''}</span>
          <span>{formatBRL(-order.discountCents)}</span>
        </p>
      ) : null}
      <p className="ticket-row ticket-big">
        <span>Total</span>
        <span>{formatBRL(order.totalCents)}</span>
      </p>
      <p className="ticket-strong">{paymentLine(order)}</p>
      {order.notes ? <p>Obs.: {order.notes}</p> : null}
    </section>
  );
}

/**
 * O que vai para a impressora. Fica fora da tela e é a única coisa que aparece no papel:
 * por isso é montado direto no corpo da página, e não dentro do painel.
 */
export function PrintTickets({
  orders,
  storeName,
  settings,
}: {
  orders: PanelOrderView[];
  storeName: string;
  settings: PrintSettings;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="print-root" data-paper={settings.paper}>
      {orders.map((order) => (
        <div key={order.id}>
          {settings.kitchen ? <KitchenTicket order={order} storeName={storeName} /> : null}
          {settings.customer ? <CustomerTicket order={order} storeName={storeName} /> : null}
        </div>
      ))}
    </div>,
    document.body,
  );
}
