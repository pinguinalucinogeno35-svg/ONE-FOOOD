'use client';

import type { MeView } from '@onefood/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, errorMessage } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSending(true);
    setError(null);
    try {
      const me = await api<MeView>('/v1/auth/login', {
        method: 'POST',
        body: { email: form.get('email'), password: form.get('password') },
      });
      const store = me.stores[0];
      router.push(store ? `/painel/${store.slug}/pedidos` : '/painel');
    } catch (failure) {
      setError(errorMessage(failure));
      setSending(false);
    }
  };

  return (
    <main>
      <h1>Entrar</h1>
      <p className="muted">Acesse o painel do seu restaurante.</p>
      <form className="stack" onSubmit={submit} style={{ marginTop: 24 }}>
        <label className="field">
          <span>E-mail</span>
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label className="field">
          <span>Senha</span>
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={sending}>
          {sending ? 'Entrando' : 'Entrar'}
        </button>
        <p className="muted">
          Ainda não tem conta? <Link href="/cadastro">Criar minha loja</Link>
        </p>
      </form>
    </main>
  );
}
