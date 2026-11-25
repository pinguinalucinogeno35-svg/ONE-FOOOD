'use client';

import {
  type CourierAccessView,
  type CourierView,
  formatBRL,
  formatPhoneBR,
  type PendingSettlementView,
  parseBRL,
  type SettlementsView,
  toE164BR,
} from '@onefood/shared';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { IconDelivery, IconPlus } from '../../../../components/icons';
import { api, errorMessage } from '../../../../lib/api';
import { deliveriesLabel, settlementLine } from '../../../../lib/settlement';
import { usePanelStore } from '../store-context';

interface AccessLink {
  courier: { name: string; phone: string };
  url: string;
}

export default function CouriersPage() {
  const store = usePanelStore();
  const base = `/v1/panel/stores/${store.slug}/couriers`;
  const [couriers, setCouriers] = useState<CourierView[] | null>(null);
  const [settlements, setSettlements] = useState<SettlementsView | null>(null);
  const [editing, setEditing] = useState<CourierView | null>(null);
  const feeDialog = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState<AccessLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCouriers(await api<CourierView[]>(base));
      setSettlements(await api<SettlementsView>(`/v1/panel/stores/${store.slug}/courier-settlements`));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, [base, store.slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showLink = (courier: { name: string; phone: string }, access: CourierAccessView) => {
    setCopied(false);
    setLink({ courier, url: `${window.location.origin}/entregador/${access.accessToken}` });
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('name') ?? '').trim();
    const phone = toE164BR(String(form.get('phone') ?? ''));
    if (!phone) {
      setError('Confira o telefone: informe o DDD e o número.');
      return;
    }
    const fee = String(form.get('fee') ?? '').trim();
    const feePerDeliveryCents = fee ? parseBRL(fee) : null;
    if (fee && feePerDeliveryCents === null) {
      setError('Valor por entrega inválido. Use um valor como 5,00 ou deixe em branco.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const access = await api<CourierAccessView>(base, {
        method: 'POST',
        body: { name, phone, feePerDeliveryCents },
      });
      formElement.reset();
      showLink({ name, phone }, access);
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setSaving(false);
  };

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      setError(null);
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const newLink = (courier: CourierView) => {
    if (!window.confirm(`Gerar um novo link para ${courier.name}? O link atual para de funcionar.`)) return;
    void run(async () => {
      showLink(courier, await api<CourierAccessView>(`${base}/${courier.id}/access-token`, { method: 'POST' }));
    });
  };

  const closeSettlement = (pending: PendingSettlementView) => {
    const question = `Fechar o acerto de ${pending.courierName}? ${settlementLine(pending, pending.courierName)}.`;
    if (!window.confirm(question)) return;
    void run(() =>
      api(`/v1/panel/stores/${store.slug}/courier-settlements`, {
        method: 'POST',
        body: { courierId: pending.courierId },
      }),
    );
  };

  const saveFee = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const fee = String(new FormData(event.currentTarget).get('fee') ?? '').trim();
    const feePerDeliveryCents = fee ? parseBRL(fee) : null;
    if (fee && feePerDeliveryCents === null) {
      setError('Valor por entrega inválido. Use um valor como 5,00 ou deixe em branco.');
      return;
    }
    const courierId = editing.id;
    feeDialog.current?.close();
    await run(() => api(`${base}/${courierId}`, { method: 'PATCH', body: { feePerDeliveryCents } }));
  };

  const whatsappUrl = link
    ? `https://wa.me/${link.courier.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
        `Olá, ${link.courier.name}. Este é o seu link de entregas de ${store.name}: ${link.url}`,
      )}`
    : '';

  return (
    <main>
      <h1>Entregadores</h1>
      <p className="muted">
        Cada entregador recebe um link pessoal. Por ele, vê as entregas, avisa quando saiu e quando entregou.
      </p>
      {error ? (
        <p className="error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}

      {link ? (
        <section className="card stack" style={{ marginTop: 24 }} aria-label="Link de acesso">
          <div>
            <h3>Link de {link.courier.name}</h3>
            <p className="muted">
              Envie para o entregador. O link aparece só agora; se perder, gere um novo na lista abaixo.
            </p>
          </div>
          <input
            readOnly
            value={link.url}
            aria-label="Link de acesso do entregador"
            onFocus={(event) => event.target.select()}
          />
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link.url);
                  setCopied(true);
                } catch {
                  setError('Não deu para copiar. Selecione o link e copie à mão.');
                }
              }}
            >
              {copied ? 'Link copiado' : 'Copiar link'}
            </button>
            <a className="btn btn-primary" href={whatsappUrl} target="_blank" rel="noreferrer">
              Enviar por WhatsApp
            </a>
            <button type="button" className="btn btn-quiet" onClick={() => setLink(null)}>
              Fechar
            </button>
          </div>
        </section>
      ) : null}

      {settlements && settlements.pending.length > 0 ? (
        <section aria-label="Acerto pendente">
          <h2>Acerto pendente</h2>
          <div className="stack">
            {settlements.pending.map((pending) => (
              <article key={pending.courierId} className="card stack" style={{ gap: 8 }}>
                <div className="row between">
                  <h3>{pending.courierName}</h3>
                  <span className="muted">
                    {deliveriesLabel(pending.deliveries)} desde{' '}
                    {new Date(pending.since).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  </span>
                </div>
                <div className="totals">
                  <div>
                    <span>A pagar ao entregador</span>
                    <span className="tabular">{formatBRL(pending.feesCents)}</span>
                  </div>
                  <div>
                    <span>Dinheiro recebido por ele</span>
                    <span className="tabular">{formatBRL(pending.cashCents)}</span>
                  </div>
                </div>
                <p>
                  <strong>{settlementLine(pending, pending.courierName)}</strong>
                </p>
                {store.canEdit ? (
                  <button type="button" className="btn btn-primary" onClick={() => closeSettlement(pending)}>
                    Fechar acerto
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <h2>Equipe</h2>
      {couriers === null ? (
        <p className="muted">Carregando.</p>
      ) : couriers.length === 0 ? (
        <p className="empty">Nenhum entregador cadastrado ainda.</p>
      ) : (
        <ul className="list">
          {couriers.map((courier) => (
            <li key={courier.id} className="line">
              <span className="row" style={{ gap: 8 }}>
                <IconDelivery />
                <strong>{courier.name}</strong>
                {courier.active ? null : <span className="tag tag-quiet">Desligado</span>}
              </span>
              {store.canEdit ? (
                <span className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => {
                      setEditing(courier);
                      feeDialog.current?.showModal();
                    }}
                  >
                    Valor por entrega
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => newLink(courier)}
                    disabled={!courier.active}
                  >
                    Novo link
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() =>
                      run(() => api(`${base}/${courier.id}`, { method: 'PATCH', body: { active: !courier.active } }))
                    }
                  >
                    {courier.active ? 'Desligar' : 'Ligar'}
                  </button>
                </span>
              ) : (
                <span />
              )}
              <span className="muted product-detail">
                {formatPhoneBR(courier.phone)} ·{' '}
                {courier.feePerDeliveryCents === null
                  ? 'recebe a taxa de entrega de cada pedido'
                  : `recebe ${formatBRL(courier.feePerDeliveryCents)} por entrega`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {store.canEdit ? (
        <form className="card stack" onSubmit={create} style={{ marginTop: 32 }}>
          <h3>Novo entregador</h3>
          <label className="field">
            <span>Nome</span>
            <input name="name" required maxLength={120} />
          </label>
          <label className="field">
            <span>Telefone com DDD</span>
            <input name="phone" required type="tel" inputMode="tel" placeholder="(11) 99999-0000" />
          </label>
          <label className="field">
            <span>Valor pago por entrega (R$)</span>
            <input name="fee" inputMode="decimal" placeholder="Em branco: a taxa de entrega do pedido" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <IconPlus />
            {saving ? 'Cadastrando' : 'Cadastrar entregador'}
          </button>
        </form>
      ) : null}

      {settlements && settlements.recent.length > 0 ? (
        <section aria-label="Últimos acertos">
          <h2>Últimos acertos</h2>
          <ul className="list">
            {settlements.recent.map((closed) => (
              <li key={closed.id} className="line">
                <span>
                  <strong>{closed.courierName}</strong> · {deliveriesLabel(closed.deliveries)}
                </span>
                <span className="muted">
                  {new Date(closed.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                <span className="muted product-detail">
                  A pagar {formatBRL(closed.feesCents)} · dinheiro recebido {formatBRL(closed.cashCents)} ·{' '}
                  {settlementLine(closed, closed.courierName)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <dialog ref={feeDialog} aria-labelledby="fee-title" onClose={() => setEditing(null)}>
        <form onSubmit={saveFee}>
          <div className="dialog-body">
            <h3 id="fee-title">Quanto {editing?.name ?? 'o entregador'} recebe por entrega</h3>
            <label className="field">
              <span>Valor por entrega (R$)</span>
              <input
                key={editing?.id}
                name="fee"
                inputMode="decimal"
                placeholder="Em branco: a taxa de entrega do pedido"
                defaultValue={
                  editing?.feePerDeliveryCents == null ? '' : formatBRL(editing.feePerDeliveryCents).replace('R$ ', '')
                }
              />
              <small>Vale para as entregas ainda não acertadas e para as próximas.</small>
            </label>
          </div>
          <div className="dialog-foot row">
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
              Salvar
            </button>
            <button type="button" className="btn" onClick={() => feeDialog.current?.close()}>
              Cancelar
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
