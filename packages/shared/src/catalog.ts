export interface MenuOptionView {
  id: string;
  name: string;
  priceDeltaCents: number;
}

export interface MenuOptionGroupView {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOptionView[];
}

export interface MenuProductView {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  optionGroups: MenuOptionGroupView[];
}

export interface MenuCategoryView {
  id: string;
  name: string;
  products: MenuProductView[];
}

export interface MenuView {
  store: {
    slug: string;
    name: string;
    deliveryFeeCents: number;
  };
  categories: MenuCategoryView[];
}
