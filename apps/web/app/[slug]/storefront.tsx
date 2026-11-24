'use client';

import { formatBRL, type MenuProductView, type MenuView } from '@onefood/shared';
import { useEffect, useState } from 'react';
import { IconBag } from '../../components/icons';
import { type CartLine, countOf, lineFrom, loadCart, saveCart, subtotalOf } from './cart';
import { Checkout } from './checkout';
import { ProductDialog } from './product-dialog';

export function Storefront({ menu }: { menu: MenuView }) {
  const slug = menu.store.slug;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<MenuProductView | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    setLines(loadCart(slug));
    setLoaded(true);
  }, [slug]);
  useEffect(() => {
    if (loaded) saveCart(slug, lines);
  }, [slug, lines, loaded]);

  if (checkingOut) {
    return (
      <Checkout
        menu={menu}
        lines={lines}
        onChange={setLines}
        onBack={() => setCheckingOut(false)}
        onPlaced={() => setLines([])}
      />
    );
  }

  const count = countOf(lines);
  return (
    <main>
      <h1>{menu.store.name}</h1>
      <p className="muted">
        {menu.store.deliveryFeeCents > 0 ? `Entrega: ${formatBRL(menu.store.deliveryFeeCents)}` : 'Entrega grátis'}
      </p>

      {menu.categories.length === 0 ? (
        <p className="empty" style={{ marginTop: 24 }}>
          O cardápio desta loja ainda está sendo montado.
        </p>
      ) : null}

      {menu.categories.map((category) => (
        <section key={category.id}>
          <h2>{category.name}</h2>
          <ul className="list">
            {category.products.map((product) => (
              <li key={product.id}>
                <button type="button" className="product" onClick={() => setSelected(product)}>
                  <span className="product-name">{product.name}</span>
                  <span className="product-price">{formatBRL(product.priceCents)}</span>
                  {product.description ? <span className="muted product-detail">{product.description}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {selected ? (
        <ProductDialog
          product={selected}
          onClose={() => setSelected(null)}
          onAdd={(optionIds, quantity, notes) => {
            setLines((current) => [...current, lineFrom(selected, optionIds, quantity, notes)]);
            setSelected(null);
          }}
        />
      ) : null}

      {count > 0 ? (
        <div className="cartbar">
          <button type="button" className="btn btn-primary btn-block" onClick={() => setCheckingOut(true)}>
            <span className="row">
              <IconBag />
              Ver pedido ({count})
            </span>
            <span className="tabular">{formatBRL(subtotalOf(lines))}</span>
          </button>
        </div>
      ) : null}
    </main>
  );
}
