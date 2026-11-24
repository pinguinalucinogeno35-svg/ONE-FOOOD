'use client';

import { type AdminCategoryView, type AdminMenuView, type AdminProductView, formatBRL } from '@onefood/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { IconEdit, IconPlus } from '../../../../components/icons';
import { api, errorMessage } from '../../../../lib/api';
import { usePanelStore } from '../store-context';
import { ProductEditor } from './product-editor';

type Editing = { category: AdminCategoryView; product: AdminProductView | null };

export default function MenuAdminPage() {
  const store = usePanelStore();
  const base = `/v1/panel/stores/${store.slug}`;
  const [menu, setMenu] = useState<AdminMenuView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMenu(await api<AdminMenuView>(`${base}/menu`));
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const addCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;
    await run(() =>
      api(`${base}/categories`, { method: 'POST', body: { name, position: menu?.categories.length ?? 0 } }),
    );
    form.reset();
  };

  if (!menu) {
    return (
      <main>
        <h1>Cardápio</h1>
        <p className={error ? 'error' : 'muted'}>{error ?? 'Carregando.'}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Cardápio</h1>
      <p className="muted">O que você muda aqui aparece no cardápio público em seguida.</p>
      {error ? (
        <p className="error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}

      {menu.categories.length === 0 ? (
        <p className="empty" style={{ marginTop: 24 }}>
          Comece criando uma categoria, como Lanches ou Bebidas.
        </p>
      ) : null}

      {menu.categories.map((category) => (
        <section key={category.id}>
          <div className="row between">
            <h2>
              {category.name}
              {category.active ? '' : ' (desativada)'}
            </h2>
            {store.canEdit ? (
              <button
                type="button"
                className="btn btn-small btn-quiet"
                onClick={() =>
                  run(() =>
                    api(`${base}/categories/${category.id}`, { method: 'PATCH', body: { active: !category.active } }),
                  )
                }
              >
                {category.active ? 'Desativar' : 'Ativar'}
              </button>
            ) : null}
          </div>
          <ul className="list">
            {category.products.map((product) => (
              <li key={product.id} className="line">
                <span className="product-name">{product.name}</span>
                <span className="product-price">{formatBRL(product.priceCents)}</span>
                <span className="muted">
                  {product.active ? 'No cardápio' : 'Fora do cardápio'}
                  {product.optionGroups.length > 0
                    ? ` · ${product.optionGroups.length} ${product.optionGroups.length === 1 ? 'grupo' : 'grupos'} de opções`
                    : ''}
                </span>
                {store.canEdit ? (
                  <span className="row" style={{ gap: 4 }}>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() =>
                        run(() =>
                          api(`${base}/products/${product.id}`, { method: 'PATCH', body: { active: !product.active } }),
                        )
                      }
                    >
                      {product.active ? 'Pausar' : 'Voltar'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-icon"
                      aria-label={`Editar ${product.name}`}
                      onClick={() => setEditing({ category, product })}
                    >
                      <IconEdit />
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
            {category.products.length === 0 ? <li className="line muted">Nenhum produto nesta categoria.</li> : null}
          </ul>
          {store.canEdit ? (
            <button
              type="button"
              className="btn btn-small"
              style={{ marginTop: 8 }}
              onClick={() => setEditing({ category, product: null })}
            >
              <IconPlus />
              Novo produto
            </button>
          ) : null}
        </section>
      ))}

      {store.canEdit ? (
        <form className="card stack" onSubmit={addCategory} style={{ marginTop: 32 }}>
          <label className="field">
            <span>Nova categoria</span>
            <input name="name" required maxLength={80} placeholder="Ex.: Lanches" />
          </label>
          <button type="submit" className="btn">
            <IconPlus />
            Criar categoria
          </button>
        </form>
      ) : null}

      {editing ? (
        <ProductEditor
          base={base}
          categories={menu.categories}
          category={editing.category}
          product={editing.product}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
    </main>
  );
}
