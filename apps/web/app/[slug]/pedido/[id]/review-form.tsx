'use client';

import type { OrderReviewView, TrackedOrderView } from '@onefood/shared';
import { type FormEvent, useState } from 'react';
import { StarRating } from '../../../../components/star-rating';
import { api, errorMessage } from '../../../../lib/api';

interface Props {
  slug: string;
  order: TrackedOrderView;
  onReviewed: (review: OrderReviewView) => void;
}

/** Avaliação do pedido concluído: nota geral obrigatória, nota por prato e comentário opcionais. */
export function ReviewForm({ slug, order, onReviewed }: Props) {
  const [rating, setRating] = useState(0);
  const [itemRatings, setItemRatings] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (order.review) {
    return (
      <section className="card stack" style={{ marginTop: 16 }}>
        <div>
          <h3>Obrigado pela avaliação</h3>
          <p className="muted">Sua opinião chega direto ao restaurante.</p>
        </div>
        <StarRating label="Sua nota" value={order.review.rating} />
        {order.review.comment ? <p className="muted">{order.review.comment}</p> : null}
      </section>
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (rating === 0) {
      setError('Escolha uma nota de 1 a 5.');
      return;
    }
    const comment = String(new FormData(event.currentTarget).get('comment') ?? '').trim();
    setSending(true);
    setError(null);
    try {
      const review = await api<OrderReviewView>(`/v1/stores/${slug}/orders/${order.id}/review`, {
        method: 'POST',
        body: {
          rating,
          comment: comment || undefined,
          items: Object.entries(itemRatings).map(([lineNo, value]) => ({ lineNo: Number(lineNo), rating: value })),
        },
      });
      onReviewed(review);
    } catch (failure) {
      setError(errorMessage(failure));
      setSending(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} style={{ marginTop: 16 }}>
      <div>
        <h3>Como foi o seu pedido?</h3>
        <p className="muted">Leva menos de um minuto e ajuda o restaurante a melhorar.</p>
      </div>
      <StarRating label="Nota do pedido" value={rating} onChange={setRating} size={32} />

      {order.items.length > 1 ? (
        <div className="stack" style={{ gap: 8 }}>
          <span className="muted">Se quiser, dê uma nota para cada item:</span>
          {order.items.map((item) => (
            <div key={item.lineNo} className="row between">
              <span>{item.productName}</span>
              <StarRating
                label={`Nota de ${item.productName}`}
                value={itemRatings[item.lineNo] ?? 0}
                onChange={(value) => setItemRatings((current) => ({ ...current, [item.lineNo]: value }))}
                size={20}
              />
            </div>
          ))}
        </div>
      ) : null}

      <label className="field">
        <span>Quer contar mais?</span>
        <textarea name="comment" rows={3} maxLength={1000} placeholder="Opcional" />
      </label>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={sending}>
        {sending ? 'Enviando' : 'Enviar avaliação'}
      </button>
    </form>
  );
}
