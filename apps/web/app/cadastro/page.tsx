'use client';

import { type MeView, signupSchema } from '@onefood/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, errorMessage } from '../../lib/api';

/** "Cantina do Zé" -> "cantina-do-ze" */
function suggestSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export default function SignupPage() {
  const router = useRouter();
  const [storeName, setStoreName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = signupSchema.safeParse({
      name: form.get('name'),
      email: form.get('email'),
      password: form.get('password'),
      storeName,
      storeSlug: slug,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where =
        issue?.path[0] === 'storeSlug' ? 'Endereço da loja' : issue?.path[0] === 'password' ? 'Senha' : 'Dados';
      setError(`${where}: ${issue?.message ?? 'confira e tente de novo'}.`);
      return;
    }

    setSending(true);
    setError(null);
    try {
      const me = await api<MeView>('/v1/auth/signup', { method: 'POST', body: parsed.data });
      router.push(`/painel/${me.stores[0]?.slug ?? ''}/cardapio`);
    } catch (failure) {
      setError(errorMessage(failure));
      setSending(false);
    }
  };

  return (
    <main>
      <h1>Criar minha loja</h1>
      <p className="muted">Em poucos minutos seu cardápio está no ar e recebendo pedidos.</p>
      <form className="stack" onSubmit={submit} style={{ marginTop: 24 }}>
        <label className="field">
          <span>Nome do restaurante</span>
          <input
            value={storeName}
            required
            maxLength={120}
            onChange={(event) => {
              setStoreName(event.target.value);
              if (!slugEdited) setSlug(suggestSlug(event.target.value));
            }}
          />
        </label>
        <label className="field">
          <span>Endereço do cardápio</span>
          <input
            value={slug}
            required
            minLength={3}
            maxLength={60}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(event.target.value.toLowerCase());
            }}
          />
          <small>Seus clientes vão pedir em onefood.com.br/{slug || 'sua-loja'}</small>
        </label>
        <label className="field">
          <span>Seu nome</span>
          <input name="name" required maxLength={120} autoComplete="name" />
        </label>
        <label className="field">
          <span>E-mail</span>
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label className="field">
          <span>Senha</span>
          <input name="password" type="password" required minLength={10} autoComplete="new-password" />
          <small>Pelo menos 10 caracteres.</small>
        </label>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={sending}>
          {sending ? 'Criando' : 'Criar loja'}
        </button>
        <p className="muted">
          Já tem conta? <Link href="/entrar">Entrar</Link>
        </p>
      </form>
    </main>
  );
}
