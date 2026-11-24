import { z } from 'zod';

const rating = z.number().int().min(1).max(5);

/** Nota de 1 ou 2 é considerada baixa e avisa o restaurante na hora. */
export const LOW_RATING_MAX = 2;

export const createReviewSchema = z.object({
  rating,
  comment: z.string().trim().max(1000).optional(),
  /** Nota por prato, opcional. lineNo é a linha do item no pedido. */
  items: z
    .array(z.object({ lineNo: z.number().int().min(1), rating }))
    .max(100)
    .default([])
    .refine((items) => new Set(items.map((item) => item.lineNo)).size === items.length, 'item repetido'),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export interface ReviewItemRating {
  lineNo: number;
  productId: string;
  productName: string;
  rating: number;
}

export interface OrderReviewView {
  rating: number;
  comment: string | null;
  items: ReviewItemRating[];
  createdAt: string;
}

export interface PanelReviewView extends OrderReviewView {
  orderId: string;
  orderNumber: number;
  customerName: string;
}

export interface ReviewsSummaryView {
  count: number;
  /** Média com uma casa decimal, ou null se ainda não há avaliações. */
  average: number | null;
  lowCount: number;
  products: Array<{ productId: string; productName: string; average: number; count: number }>;
  reviews: PanelReviewView[];
}
