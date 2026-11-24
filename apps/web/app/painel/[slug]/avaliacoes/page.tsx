'use client';

import { LOW_RATING_MAX, type ReviewsSummaryView } from '@onefood/shared';
import { useEffect, useState } from 'react';
import { StarRating } from '../../../../components/star-rating';
import { api, errorMessage } from '../../../../lib/api';
import { usePanelStore } from '../store-context';

const oneDecimal = (value: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function ReviewsPage() {
  const store = usePanelStore();
  const [summary, setSummary] = useState<ReviewsSummaryView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ReviewsSummaryView>(`/v1/panel/stores/${store.slug}/reviews`).then(setSummary, (failure) =>
      setError(errorMessage(failure)),
    );
  }, [store.slug]);

  if (!summary) {
    return (
      <main>
        <h1>Avaliações</h1>
        <p className={error ? 'error' : 'muted'}>{error ?? 'Carregando.'}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Avaliações</h1>
      <p className="muted">O que os clientes disseram depois de receber o pedido.</p>

      {summary.count === 0 ? (
        <p className="empty" style={{ marginTop: 24 }}>
          Ainda não há avaliações. Elas aparecem aqui quando um cliente avalia um pedido concluído.
        </p>
      ) : (
        <>
          <div className="card stats" style={{ marginTop: 24 }}>
            <div className="stat">
              <span className="muted">Nota média</span>
              <strong>{summary.average === null ? '' : oneDecimal(summary.average)}</strong>
            </div>
            <div className="stat">
              <span className="muted">Avaliações</span>
              <strong>{summary.count}</strong>
            </div>
            <div className="stat">
              <span className="muted">Notas baixas</span>
              <strong className={summary.lowCount > 0 ? 'late' : undefined}>{summary.lowCount}</strong>
            </div>
          </div>

          {summary.products.length > 0 ? (
            <>
              <h2>Por prato, do pior para o melhor</h2>
              <ul className="list">
                {summary.products.map((product) => (
                  <li key={product.productId} className="line">
                    <span className="product-name">{product.productName}</span>
                    <strong className={product.average <= LOW_RATING_MAX ? 'tabular late' : 'tabular'}>
                      {oneDecimal(product.average)}
                    </strong>
                    <span className="muted product-detail">
                      {product.count} {product.count === 1 ? 'nota' : 'notas'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h2>Mais recentes</h2>
          <ul className="list">
            {summary.reviews.map((review) => (
              <li key={review.orderId} className="line">
                <span>
                  <strong>Pedido {review.orderNumber}</strong> · {review.customerName}
                </span>
                <StarRating label="Nota" value={review.rating} size={18} />
                {review.comment ? <span className="product-detail">{review.comment}</span> : null}
                <span className="muted product-detail">
                  {new Date(review.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  {review.items.length > 0
                    ? ` · ${review.items.map((item) => `${item.productName}: ${item.rating}`).join(', ')}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
