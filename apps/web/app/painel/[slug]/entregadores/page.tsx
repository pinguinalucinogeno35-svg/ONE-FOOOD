'use client';

import { type CourierAccessView, type CourierView, formatPhoneBR, toE164BR } from '@onefood/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { IconDelivery, IconPlus } from '../../../../components/icons';
import { api, errorMessage } from '../../../../lib/api';
import { usePanelStore } from '../store-context';

interface AccessLink {
  courier: { name: string; phone: string };
  url: string;
}

export default function CouriersPage() {
  const store = usePanelStore();
  const base = `/v1/panel/stores/${store.slug}/couriers`;
  const [couriers, setCouriers] = useState<CourierView[] | null>(null);
  const [link, setLink] = useState<AccessLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCouriers(await api<CourierView[]>(base));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, [base]);

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
    setSaving(true);
    setError(null);
    try {
      const access = await api<CourierAccessView>(base, { method: 'POST', body: { name, phone } });
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

      {couriers === null ? (
        <p className="muted" style={{ marginTop: 24 }}>
          Carregando.
        </p>
      ) : couriers.length === 0 ? (
        <p className="empty" style={{ marginTop: 24 }}>
          Nenhum entregador cadastrado ainda.
        </p>
      ) : (
        <ul className="list" style={{ marginTop: 24 }}>
          {couriers.map((courier) => (
            <li key={courier.id} className="line">
              <span className="row" style={{ gap: 8 }}>
                <IconDelivery />
                <strong>{courier.name}</strong>
                {courier.active ? null : <span className="tag tag-quiet">Desligado</span>}
              </span>
              {store.canEdit ? (
                <span className="row" style={{ gap: 4 }}>
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
              <span className="muted product-detail">{formatPhoneBR(courier.phone)}</span>
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
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <IconPlus />
            {saving ? 'Cadastrando' : 'Cadastrar entregador'}
          </button>
        </form>
      ) : null}
    </main>
  );
}
