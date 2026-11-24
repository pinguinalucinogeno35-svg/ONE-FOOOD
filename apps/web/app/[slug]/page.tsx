import { formatBRL, type MenuView } from '@onefood/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

/**
 * O cardápio é gerado no servidor e reaproveitado por 60 segundos: abre rápido
 * e uma visita não vira uma consulta ao banco.
 */
async function getMenu(slug: string): Promise<MenuView | null> {
  const res = await fetch(`${API_URL}/v1/stores/${encodeURIComponent(slug)}/menu`, { next: { revalidate: 60 } });
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

  return (
    <main>
      <h1>{menu.store.name}</h1>
      <p className="muted">
        {menu.store.deliveryFeeCents > 0 ? `Entrega: ${formatBRL(menu.store.deliveryFeeCents)}` : 'Entrega grátis'}
      </p>

      {menu.categories.map((category) => (
        <section key={category.id}>
          <h2>{category.name}</h2>
          <ul className="products">
            {category.products.map((product) => (
              <li key={product.id} className="product">
                <span className="product-name">{product.name}</span>
                <span className="product-price">{formatBRL(product.priceCents)}</span>
                {product.description ? <p className="muted product-detail">{product.description}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
