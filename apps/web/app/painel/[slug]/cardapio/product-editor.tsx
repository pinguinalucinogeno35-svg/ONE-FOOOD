'use client';

import {
  type AdminCategoryView,
  type AdminProductView,
  formatBRL,
  parseBRL,
  replaceOptionGroupsSchema,
} from '@onefood/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { IconClose, IconPlus, IconTrash } from '../../../../components/icons';
import { api, errorMessage } from '../../../../lib/api';

interface OptionDraft {
  key: string;
  name: string;
  price: string;
}
interface GroupDraft {
  key: string;
  name: string;
  required: boolean;
  max: string;
  options: OptionDraft[];
}

interface Props {
  base: string;
  categories: AdminCategoryView[];
  category: AdminCategoryView;
  product: AdminProductView | null;
  onClose: () => void;
  onSaved: () => void;
}

const plain = (cents: number) => formatBRL(cents).replace('R$ ', '');
const newOption = (): OptionDraft => ({ key: crypto.randomUUID(), name: '', price: '' });

export function ProductEditor({ base, categories, category, product, onClose, onSaved }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState<GroupDraft[]>(() =>
    (product?.optionGroups ?? []).map((group) => ({
      key: group.id,
      name: group.name,
      required: group.minSelect > 0,
      max: String(group.maxSelect),
      options: group.options
        .filter((option) => option.active)
        .map((option) => ({
          key: option.id,
          name: option.name,
          price: option.priceDeltaCents ? plain(option.priceDeltaCents) : '',
        })),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const patchGroup = (key: string, patch: Partial<GroupDraft>) =>
    setGroups((current) => current.map((group) => (group.key === key ? { ...group, ...patch } : group)));
  const patchOption = (groupKey: string, optionKey: string, patch: Partial<OptionDraft>) =>
    setGroups((current) =>
      current.map((group) =>
        group.key === groupKey
          ? {
              ...group,
              options: group.options.map((option) => (option.key === optionKey ? { ...option, ...patch } : option)),
            }
          : group,
      ),
    );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const priceCents = parseBRL(String(form.get('price') ?? ''));
    if (priceCents === null) {
      setError('Preço inválido. Use um valor como 28,00.');
      return;
    }

    const optionGroups = [];
    for (const group of groups) {
      const options = [];
      for (const option of group.options.filter((candidate) => candidate.name.trim())) {
        const delta = option.price.trim() ? parseBRL(option.price) : 0;
        if (delta === null) {
          setError(`Valor inválido na opção ${option.name}.`);
          return;
        }
        options.push({ name: option.name.trim(), priceDeltaCents: delta, active: true });
      }
      optionGroups.push({
        name: group.name.trim(),
        minSelect: group.required ? 1 : 0,
        maxSelect: Math.max(1, Number.parseInt(group.max, 10) || 1),
        options,
      });
    }
    const checked = replaceOptionGroupsSchema.safeParse({ groups: optionGroups });
    if (!checked.success) {
      setError('Confira os grupos de opções: cada grupo precisa de nome e de pelo menos uma opção.');
      return;
    }

    const body = {
      categoryId: String(form.get('categoryId')),
      name: String(form.get('name') ?? '').trim(),
      description: String(form.get('description') ?? '').trim() || null,
      priceCents,
    };
    setSaving(true);
    setError(null);
    try {
      let productId = product?.id;
      if (productId) await api(`${base}/products/${productId}`, { method: 'PATCH', body });
      else productId = (await api<{ id: string }>(`${base}/products`, { method: 'POST', body })).id;
      await api(`${base}/products/${productId}/option-groups`, { method: 'PUT', body: checked.data });
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
      setSaving(false);
    }
  };

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="editor-title">
      <form onSubmit={submit}>
        <div className="dialog-body">
          <div className="row between">
            <h3 id="editor-title">{product ? 'Editar produto' : 'Novo produto'}</h3>
            <button type="button" className="btn btn-quiet btn-icon" onClick={onClose} aria-label="Fechar">
              <IconClose />
            </button>
          </div>

          <label className="field">
            <span>Nome</span>
            <input name="name" required maxLength={120} defaultValue={product?.name ?? ''} />
          </label>
          <label className="field">
            <span>Descrição</span>
            <input name="description" maxLength={500} defaultValue={product?.description ?? ''} />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Preço (R$)</span>
              <input
                name="price"
                required
                inputMode="decimal"
                placeholder="28,00"
                defaultValue={product ? plain(product.priceCents) : ''}
              />
            </label>
            <label className="field">
              <span>Categoria</span>
              <select name="categoryId" defaultValue={product?.categoryId ?? category.id}>
                {categories.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="stack">
            <div>
              <strong>Opções do produto</strong>
              <p className="muted">Tamanhos, sabores, adicionais. O cliente escolhe ao pedir.</p>
            </div>
            {groups.map((group) => (
              <div key={group.key} className="group-editor">
                <div className="row">
                  <label className="field" style={{ flex: 1 }}>
                    <span>Nome do grupo</span>
                    <input
                      value={group.name}
                      maxLength={80}
                      placeholder="Ex.: Tamanho"
                      onChange={(event) => patchGroup(group.key, { name: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-icon btn-danger"
                    style={{ alignSelf: 'end' }}
                    aria-label={`Remover grupo ${group.name || 'sem nome'}`}
                    onClick={() => setGroups((current) => current.filter((candidate) => candidate.key !== group.key))}
                  >
                    <IconTrash />
                  </button>
                </div>
                <div className="grid-2">
                  <label className="choice">
                    <input
                      type="checkbox"
                      checked={group.required}
                      onChange={(event) => patchGroup(group.key, { required: event.target.checked })}
                    />
                    <span>Escolha obrigatória</span>
                  </label>
                  <label className="field">
                    <span>Máximo de escolhas</span>
                    <input
                      value={group.max}
                      inputMode="numeric"
                      onChange={(event) => patchGroup(group.key, { max: event.target.value.replace(/\D/g, '') })}
                    />
                  </label>
                </div>
                {group.options.map((option) => (
                  <div key={option.key} className="option-row">
                    <input
                      value={option.name}
                      maxLength={80}
                      placeholder="Opção"
                      aria-label="Nome da opção"
                      onChange={(event) => patchOption(group.key, option.key, { name: event.target.value })}
                    />
                    <input
                      value={option.price}
                      inputMode="decimal"
                      placeholder="0,00"
                      aria-label="Acréscimo em reais"
                      onChange={(event) => patchOption(group.key, option.key, { price: event.target.value })}
                    />
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={`Remover opção ${option.name || 'sem nome'}`}
                      onClick={() =>
                        patchGroup(group.key, {
                          options: group.options.filter((candidate) => candidate.key !== option.key),
                        })
                      }
                    >
                      <IconTrash />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => patchGroup(group.key, { options: [...group.options, newOption()] })}
                >
                  <IconPlus />
                  Opção
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-small"
              onClick={() =>
                setGroups((current) => [
                  ...current,
                  { key: crypto.randomUUID(), name: '', required: false, max: '1', options: [newOption()] },
                ])
              }
            >
              <IconPlus />
              Grupo de opções
            </button>
          </div>
        </div>

        <div className="dialog-foot">
          {error ? (
            <p className="error" role="alert" style={{ marginBottom: 8 }}>
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
            {saving ? 'Salvando' : 'Salvar produto'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
