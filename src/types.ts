export type Category = "shinpan" | "kikan" | "itaku";

export interface Book {
  id: string;
  category: Category;
  title: string;
  summary: string;
  price: string;
  imageDataUrl: string | null;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  shinpan: "新刊",
  kikan: "既刊",
  itaku: "委託",
};
