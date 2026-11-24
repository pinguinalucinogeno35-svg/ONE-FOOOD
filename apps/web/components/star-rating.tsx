'use client';

import { IconStar } from './icons';

interface Props {
  label: string;
  value: number;
  onChange?: (value: number) => void;
  size?: number;
}

/** Nota de 1 a 5. Com `onChange`, é um grupo de botões; sem, só mostra a nota. */
export function StarRating({ label, value, onChange, size = 28 }: Props) {
  if (!onChange) {
    return (
      <span className="stars" role="img" aria-label={`${label}: ${value} de 5`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <IconStar key={star} filled={star <= value} width={size} height={size} />
        ))}
      </span>
    );
  }
  return (
    <span className="stars" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        // biome-ignore lint/a11y/useSemanticElements: cinco estrelas clicáveis funcionam como um grupo de opções, com um desenho que o input de rádio não permite.
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} de 5`}
          className="star"
          onClick={() => onChange(star)}
        >
          <IconStar filled={star <= value} width={size} height={size} />
        </button>
      ))}
    </span>
  );
}
