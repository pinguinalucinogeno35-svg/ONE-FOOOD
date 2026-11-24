'use client';

import { type CourierDeliveryView, type CourierHomeView, formatBRL, formatPhoneBR } from '@onefood/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconLive } from '../../../components/icons';
import { ApiError, api, errorMessage } from '../../../lib/api';
import { STATUS_LABEL } from '../../../lib/labels';
import { deliveriesLabel, settlementLine } from '../../../lib/settlement';

const REFRESH_MS = 15_000;
/** Intervalo mínimo entre dois envios de posição. */
const POSITION_EVERY_MS = 10_000;

type Sharing = 'off' | 'on' | 'denied' | 'unavailable';

function paymentLine(delivery: CourierDeliveryView): string {
  if (delivery.paymentMethod === 'cash') return `Receber ${formatBRL(delivery.totalCents)} em dinheiro`;
  if (delivery.paymentMethod === 'card_on_delivery') return `Receber ${formatBRL(delivery.totalCents)} no cartão`;
  return `Pagamento por Pix: ${formatBRL(delivery.totalCents)}`;
}

function addressLine(delivery: CourierDeliveryView): string {
  const { street, number, complement, district, city, state } = delivery.address;
  return `${street}, ${number}${complement ? `, ${complement}` : ''} · ${district}, ${city} - ${state}`;
}

function mapsUrl(delivery: CourierDeliveryView): string {
  const { street, number, district, city, state } = delivery.address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${street}, ${number}, ${district}, ${city} - ${state}`,
  )}`;
}

export function CourierHome({ token }: { token: string }) {
  const [home, setHome] = useState<CourierHomeView | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sharing, setSharing] = useState<Sharing>('off');
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);

  const headers = useCallback(() => ({ authorization: `Bearer ${token}` }), [token]);

  const refresh = useCallback(async () => {
    try {
      setHome(await api<CourierHomeView>('/v1/courier/deliveries', { headers: headers() }));
      setError(null);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) setInvalid(true);
      else setError(errorMessage(failure));
    }
  }, [headers]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const stopSharing = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  }, []);

  const startSharing = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setSharing('unavailable');
      return;
    }
    stopSharing();
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        setSharing('on');
        const now = Date.now();
        if (now - lastSent.current < POSITION_EVERY_MS) return;
        lastSent.current = now;
        api('/v1/courier/position', {
          method: 'POST',
          headers: headers(),
          body: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: Math.round(position.coords.accuracy),
          },
        }).catch(() => undefined);
      },
      (failure) => setSharing(failure.code === failure.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 5_000 },
    );
  }, [headers, stopSharing]);

  // Quem já tinha ligado a localização neste aparelho volta com ela ligada.
  useEffect(() => {
    try {
      if (localStorage.getItem('onefood:courier:sharing') === 'on') startSharing();
    } catch {
      // Sem armazenamento: o entregador liga de novo a cada visita.
    }
    return stopSharing;
  }, [startSharing, stopSharing]);

  const toggleSharing = () => {
    const turnOn = sharing !== 'on';
    if (turnOn) startSharing();
    else {
      stopSharing();
      setSharing('off');
    }
    try {
      localStorage.setItem('onefood:courier:sharing', turnOn ? 'on' : 'off');
    } catch {
      // Sem armazenamento: vale só para esta visita.
    }
  };

  const move = async (delivery: CourierDeliveryView, status: 'out_for_delivery' | 'completed') => {
    setBusy(delivery.orderId);
    try {
      await api(`/v1/courier/deliveries/${delivery.orderId}/status`, {
        method: 'POST',
        headers: headers(),
        body: { status },
      });
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setBusy(null);
    await refresh();
  };

  if (invalid) {
    return (
      <main>
        <h1>Link sem validade</h1>
        <p className="muted">Este link não vale mais. Peça um novo ao restaurante.</p>
      </main>
    );
  }
  if (!home) {
    return (
      <main>
        <h1>Minhas entregas</h1>
        <p className={error ? 'error' : 'muted'}>{error ?? 'Carregando.'}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Olá, {home.courier.name.split(' ')[0]}</h1>
      <p className="muted">Entregas de {home.store.name}</p>

      <section className="card stack" style={{ marginTop: 16 }}>
        <div className="row between">
          <strong>Minha localização</strong>
          <span className={sharing === 'on' ? 'tag tag-good' : 'tag tag-quiet'}>
            <IconLive width={16} height={16} />
            {sharing === 'on' ? 'Compartilhando' : 'Desligada'}
          </span>
        </div>
        <p className="muted">O cliente vê onde você está só enquanto o pedido dele está a caminho.</p>
        {sharing === 'denied' ? (
          <p className="error" role="alert">
            O navegador bloqueou a localização. Libere o acesso nas configurações do site e tente de novo.
          </p>
        ) : null}
        {sharing === 'unavailable' ? (
          <p className="error" role="alert">
            Não foi possível obter a localização neste aparelho.
          </p>
        ) : null}
        <button type="button" className="btn" onClick={toggleSharing}>
          {sharing === 'on' ? 'Parar de compartilhar' : 'Compartilhar localização'}
        </button>
      </section>

      {error ? (
        <p className="error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </p>
      ) : null}

      <section className="card stack" style={{ marginTop: 16, gap: 8 }} aria-label="Meu acerto">
        <div className="row between">
          <strong>Meu acerto</strong>
          <span className="muted">
            {home.settlement.deliveries === 0 ? 'Nada a acertar' : deliveriesLabel(home.settlement.deliveries)}
          </span>
        </div>
        {home.settlement.deliveries > 0 ? (
          <>
            <div className="totals">
              <div>
                <span>A receber pelas entregas</span>
                <span className="tabular">{formatBRL(home.settlement.feesCents)}</span>
              </div>
              <div>
                <span>Dinheiro que está com você</span>
                <span className="tabular">{formatBRL(home.settlement.cashCents)}</span>
              </div>
            </div>
            <p>
              <strong>{settlementLine(home.settlement, null)}</strong>
            </p>
          </>
        ) : null}
      </section>

      <h2>Entregas</h2>
      {home.deliveries.length === 0 ? (
        <p className="empty">Nenhuma entrega com você agora.</p>
      ) : (
        <div className="stack">
          {home.deliveries.map((delivery) => (
            <article key={delivery.orderId} className="card order">
              <div className="row between">
                <h3>Pedido {delivery.number}</h3>
                <span className="tag">{STATUS_LABEL[delivery.status]}</span>
              </div>
              <p>
                <strong>{delivery.customer.name}</strong> ·{' '}
                <a href={`tel:${delivery.customer.phone}`}>{formatPhoneBR(delivery.customer.phone)}</a>
              </p>
              <p>{addressLine(delivery)}</p>
              {delivery.notes ? <p className="muted">Obs.: {delivery.notes}</p> : null}
              <p className="muted">{delivery.itemsSummary}</p>
              <p>
                <strong>{paymentLine(delivery)}</strong>
              </p>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {delivery.status === 'ready' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    disabled={busy === delivery.orderId}
                    onClick={() => move(delivery, 'out_for_delivery')}
                  >
                    Saí para entrega
                  </button>
                ) : delivery.status === 'out_for_delivery' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    disabled={busy === delivery.orderId}
                    onClick={() => move(delivery, 'completed')}
                  >
                    Entreguei
                  </button>
                ) : (
                  <span className="muted" style={{ flex: 1 }}>
                    Aguardando a cozinha.
                  </span>
                )}
                <a className="btn" href={mapsUrl(delivery)} target="_blank" rel="noreferrer">
                  Abrir no mapa
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
