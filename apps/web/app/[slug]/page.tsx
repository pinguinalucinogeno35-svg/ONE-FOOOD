import type { MenuView } from '@onefood/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { menuTag } from '../../lib/menu-cache';
import { Storefront } from './storefront';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

/**
 * O cardápio é gerado no servidor e reaproveitado por 60 segundos: abre rápido
 * e uma visita não vira uma consulta ao banco. Quando o restaurante altera algo no painel,
 * a cópia guardada é descartada na hora (ver app/api/[...path]/route.ts).
 */
async function getMenu(slug: string): Promise<MenuView | null> {
  const res = await fetch(`${API_URL}/v1/stores/${encodeURIComponent(slug)}/menu`, {
    next: { revalidate: 60, tags: [menuTag(slug)] },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cardápio indisponível (${res.status})`);
  return (await res.json()) as MenuView;
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const menu = await getMenu((await params).slug);
  return { title: menu ? menu.store.name : 'Loja não encontrada' };
}

export default async function StorePage({ params }: Props) {
  const menu = await getMenu((await params).slug);
  if (!menu) notFound();
  return <Storefront menu={menu} />;
}
