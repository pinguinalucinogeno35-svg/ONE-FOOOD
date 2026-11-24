'use client';

import { formatBRL, type MenuProductView } from '@onefood/shared';
import { useEffect, useRef, useState } from 'react';
import { IconClose, IconMinus, IconPlus } from '../../components/icons';

interface Props {
  product: MenuProductView;
  onClose: () => void;
  onAdd: (optionIds: string[], quantity: number, notes: string) => void;
}

export function ProductDialog({ product, onClose, onAdd }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const toggle = (groupId: string, optionId: string, single: boolean, max: number) => {
    setChosen((current) => {
      const picked = current[groupId] ?? [];
      if (single) return { ...current, [groupId]: [optionId] };
      if (picked.includes(optionId)) return { ...current, [groupId]: picked.filter((id) => id !== optionId) };
      if (picked.length >= max) return current;
      return { ...current, [groupId]: [...picked, optionId] };
    });
  };

  const optionIds = Object.values(chosen).flat();
  const missing = product.optionGroups.find((group) => (chosen[group.id]?.length ?? 0) < group.minSelect);
  const extras = product.optionGroups
    .flatMap((group) => group.options)
    .filter((option) => optionIds.includes(option.id))
    .reduce((sum, option) => sum + option.priceDeltaCents, 0);
  const total = (product.priceCents + extras) * quantity;

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="product-title">
      <div className="dialog-body">
        <div className="row between">
          <h3 id="product-title">{product.name}</h3>
          <button type="button" className="btn btn-quiet btn-icon" onClick={onClose} aria-label="Fechar">
            <IconClose />
          </button>
        </div>
        {product.description ? <p className="muted">{product.description}</p> : null}

        {product.optionGroups.map((group) => {
          const single = group.maxSelect === 1;
          const picked = chosen[group.id] ?? [];
          return (
            <fieldset key={group.id}>
              <legend>
                {group.name}{' '}
                <span className="muted">
                  {group.minSelect > 0 ? 'obrigatório' : 'opcional'}
                  {single ? '' : `, até ${group.maxSelect}`}
                </span>
              </legend>
              {group.options.map((option) => (
                <label key={option.id} className="choice">
                  <input
                    type={single ? 'radio' : 'checkbox'}
                    name={group.id}
                    checked={picked.includes(option.id)}
                    onChange={() => toggle(group.id, option.id, single, group.maxSelect)}
                  />
                  <span>{option.name}</span>
                  {option.priceDeltaCents > 0 ? (
                    <span className="muted tabular">mais {formatBRL(option.priceDeltaCents)}</span>
                  ) : null}
                </label>
              ))}
            </fieldset>
          );
        })}

        <label className="field">
          <span>Alguma observação?</span>
          <input
            value={notes}
            maxLength={300}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ex.: sem cebola"
          />
        </label>

        <div className="row between">
          <span style={{ fontWeight: 600 }}>Quantidade</span>
          <div className="stepper">
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              disabled={quantity <= 1}
              aria-label="Diminuir quantidade"
            >
              <IconMinus />
            </button>
            <output aria-live="polite">{quantity}</output>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setQuantity((value) => Math.min(99, value + 1))}
              aria-label="Aumentar quantidade"
            >
              <IconPlus />
            </button>
          </div>
        </div>
      </div>

      <div className="dialog-foot">
        {missing ? (
          <p className="muted" style={{ marginBottom: 8 }}>
            Escolha uma opção em {missing.name}.
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={missing !== undefined}
          onClick={() => onAdd(optionIds, quantity, notes)}
        >
          <span>Adicionar</span>
          <span className="tabular">{formatBRL(total)}</span>
        </button>
      </div>
    </dialog>
  );
}
