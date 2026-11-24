'use client';

import type { MeView } from '@onefood/shared';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { type PanelStore, StoreContext } from './store-context';

const TABS = [
  { path: 'pedidos', label: 'Pedidos' },
  { path: 'cardapio', label: 'Cardápio' },
  { path: 'entregadores', label: 'Entregadores' },
  { path: 'cupons', label: 'Cupons' },
  { path: 'avaliacoes', label: 'Avaliações' },
  { path: 'loja', label: 'Loja' },
];

export default function PanelLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const [store, setStore] = useState<PanelStore | null>(null);

  useEffect(() => {
    api<MeView>('/v1/auth/me').then(
      (me) => {
        const found = me.stores.find((candidate) => candidate.slug === slug);
        if (!found) router.replace('/painel');
        else setStore({ ...found, canEdit: found.role !== 'staff' });
      },
      () => router.replace('/entrar'),
    );
  }, [slug, router]);

  const logout = async () => {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/entrar');
  };

  if (!store) {
    return (
      <main>
        <p className="muted">Carregando.</p>
      </main>
    );
  }

  return (
    <StoreContext.Provider value={store}>
      <header className="topbar">
        <strong>{store.name}</strong>
        <nav className="tabs" aria-label="Seções do painel">
          {TABS.map((tab) => {
            const href = `/painel/${slug}/${tab.path}`;
            return (
              <Link key={tab.path} href={href} aria-current={pathname === href ? 'page' : undefined}>
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <button type="button" className="btn btn-small btn-quiet" onClick={logout}>
          Sair
        </button>
      </header>
      {children}
    </StoreContext.Provider>
  );
}
