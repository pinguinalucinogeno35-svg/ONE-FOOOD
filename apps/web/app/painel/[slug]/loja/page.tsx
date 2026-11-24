'use client';

import { type AdminMenuView, formatBRL, parseBRL } from '@onefood/shared';
import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../../lib/api';
import { usePanelStore } from '../store-context';

export default function StoreSettingsPage() {
  const store = usePanelStore();
  const [menu, setMenu] = useState<AdminMenuView | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<AdminMenuView>(`/v1/panel/stores/${store.slug}/menu`).then(setMenu, (failure) =>
      setMessage({ kind: 'error', text: errorMessage(failure) }),
    );
  }, [store.slug]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const deliveryFeeCents = parseBRL(String(form.get('deliveryFee') ?? ''));
    if (deliveryFeeCents === null) {
      setMessage({ kind: 'error', text: 'Taxa de entrega inválida. Use um valor como 6,00.' });
      return;
    }
    setSaving(true);
    try {
      await api(`/v1/panel/stores/${store.slug}`, {
        method: 'PATCH',
        body: { name: String(form.get('name') ?? '').trim(), deliveryFeeCents },
      });
      setMessage({ kind: 'ok', text: 'Alterações salvas.' });
    } catch (failure) {
      setMessage({ kind: 'error', text: errorMessage(failure) });
    }
    setSaving(false);
  };

  return (
    <main>
      <h1>Loja</h1>
      <p className="muted">
        Seu cardápio público: <Link href={`/${store.slug}`}>/{store.slug}</Link>
      </p>
      {menu ? (
        <form className="stack" onSubmit={submit} style={{ marginTop: 24 }}>
          <label className="field">
            <span>Nome do restaurante</span>
            <input name="name" required maxLength={120} defaultValue={menu.store.name} disabled={!store.canEdit} />
          </label>
          <label className="field">
            <span>Taxa de entrega (R$)</span>
            <input
              name="deliveryFee"
              required
              inputMode="decimal"
              defaultValue={formatBRL(menu.store.deliveryFeeCents).replace('R$ ', '')}
              disabled={!store.canEdit}
            />
            <small>Use 0 para entrega grátis.</small>
          </label>
          {message ? (
            <p className={message.kind === 'error' ? 'error' : 'muted'} role="status">
              {message.text}
            </p>
          ) : null}
          {store.canEdit ? (
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvando' : 'Salvar'}
            </button>
          ) : (
            <p className="muted">Seu acesso permite ver, mas não alterar estes dados.</p>
          )}
        </form>
      ) : (
        <p className={message ? 'error' : 'muted'} style={{ marginTop: 24 }}>
          {message?.text ?? 'Carregando.'}
        </p>
      )}
    </main>
  );
}
