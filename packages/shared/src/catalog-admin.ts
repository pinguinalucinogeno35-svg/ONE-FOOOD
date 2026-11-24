import { z } from 'zod';

const name = (max: number) => z.string().trim().min(1).max(max);
const cents = z.number().int().min(0).max(100_000_00);
const position = z.number().int().min(0).max(10_000);

export const createCategorySchema = z.object({
  name: name(80),
  position: position.default(0),
});
export const updateCategorySchema = z
  .object({ name: name(80), position, active: z.boolean() })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'nada para alterar');

export const createProductSchema = z.object({
  categoryId: z.uuid(),
  name: name(120),
  description: z.string().trim().max(500).nullable().default(null),
  priceCents: cents,
  position: position.default(0),
});
export const updateProductSchema = z
  .object({
    categoryId: z.uuid(),
    name: name(120),
    description: z.string().trim().max(500).nullable(),
    priceCents: cents,
    position,
    active: z.boolean(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'nada para alterar');

/** O painel envia o conjunto completo de grupos de opções do produto; o servidor substitui o anterior. */
export const replaceOptionGroupsSchema = z.object({
  groups: z
    .array(
      z
        .object({
          name: name(80),
          minSelect: z.number().int().min(0).max(20),
          maxSelect: z.number().int().min(1).max(20),
          options: z
            .array(z.object({ name: name(80), priceDeltaCents: cents.default(0), active: z.boolean().default(true) }))
            .min(1)
            .max(50),
        })
        .refine((group) => group.minSelect <= group.maxSelect, 'o mínimo não pode passar do máximo')
        .refine(
          (group) => group.options.filter((option) => option.active).length >= group.minSelect,
          'faltam opções ativas para o mínimo exigido',
        ),
    )
    .max(20),
});

export const updateStoreSchema = z
  .object({ name: name(120), deliveryFeeCents: cents })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'nada para alterar');

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ReplaceOptionGroupsInput = z.infer<typeof replaceOptionGroupsSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

export interface AdminOptionView {
  id: string;
  name: string;
  priceDeltaCents: number;
  active: boolean;
}
export interface AdminOptionGroupView {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: AdminOptionView[];
}
export interface AdminProductView {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceCents: number;
  position: number;
  active: boolean;
  optionGroups: AdminOptionGroupView[];
}
export interface AdminCategoryView {
  id: string;
  name: string;
  position: number;
  active: boolean;
  products: AdminProductView[];
}
/** Cardápio como o restaurante vê no painel: inclui o que está desativado. */
export interface AdminMenuView {
  store: { slug: string; name: string; deliveryFeeCents: number };
  categories: AdminCategoryView[];
}
