'use client';

import type { Role } from '@onefood/shared';
import { createContext, useContext } from 'react';

export interface PanelStore {
  slug: string;
  name: string;
  role: Role;
  /** Dono e gerente alteram cardápio e loja; funcionário só opera pedidos. */
  canEdit: boolean;
}

export const StoreContext = createContext<PanelStore | null>(null);

export function usePanelStore(): PanelStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('usePanelStore fora do painel');
  return store;
}
