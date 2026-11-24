'use client';

import type { MeView } from '@onefood/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

/** Leva quem está logado para o painel da própria loja, e quem não está para o login. */
export default function PanelIndex() {
  const router = useRouter();
  const [noStore, setNoStore] = useState(false);

  useEffect(() => {
    api<MeView>('/v1/auth/me').then(
      (me) => {
        const store = me.stores[0];
        if (store) router.replace(`/painel/${store.slug}/pedidos`);
        else setNoStore(true);
      },
      () => router.replace('/entrar'),
    );
  }, [router]);

  return (
    <main>
      <p className="muted">{noStore ? 'Sua conta ainda não tem uma loja.' : 'Carregando.'}</p>
    </main>
  );
}
