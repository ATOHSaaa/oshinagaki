import type { Book, Category } from "./types";

/**
 * 空セルを減らしつつ、セルを大きく取りやすい列数を選ぶ。
 * 同じ無駄セル数なら √n に近い列数を優先。
 */
export function suggestGridColumns(count: number): number {
  if (count <= 0) return 1;
  if (count === 1) return 1;
  const maxCols = Math.min(6, count);
  let bestWaste = Infinity;
  const candidates: number[] = [];
  for (let c = 1; c <= maxCols; c++) {
    const rows = Math.ceil(count / c);
    const waste = c * rows - count;
    if (waste < bestWaste) {
      bestWaste = waste;
      candidates.length = 0;
      candidates.push(c);
    } else if (waste === bestWaste) {
      candidates.push(c);
    }
  }
  const target = Math.sqrt(count);
  return candidates.reduce((best, c) =>
    Math.abs(c - target) < Math.abs(best - target) ? c : best
  );
}

export function gridRows(count: number, cols: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / cols);
}

function categoryFlexMultiplier(category: Category): number {
  return category === "shinpan" ? 1.28 : category === "kikan" ? 1 : 1.14;
}

export type SheetSectionPlan = {
  category: Category;
  books: Book[];
  cols: number;
  rows: number;
  flexGrow: number;
};

/** 表示するブロックごとの列・行・縦方向の伸び率（新刊 > 既刊 ≳ 委託、行数に比例） */
export function computeSheetSections(books: Book[]): SheetSectionPlan[] {
  const by = booksByCategory(books);
  const out: SheetSectionPlan[] = [];

  const push = (category: Category, list: Book[]) => {
    if (list.length === 0) return;
    const cols = suggestGridColumns(list.length);
    const rows = gridRows(list.length, cols);
    out.push({
      category,
      books: list,
      cols,
      rows,
      flexGrow: Math.max(1, rows) * categoryFlexMultiplier(category),
    });
  };

  push("shinpan", by.shinpan);
  push("kikan", by.kikan);
  push("itaku", by.itaku);
  return out;
}

export function booksByCategory(books: Book[]): Record<Category, Book[]> {
  const shinpan = books.filter((b) => b.category === "shinpan");
  const kikan = books.filter((b) => b.category === "kikan");
  const itaku = books.filter((b) => b.category === "itaku");
  return { shinpan, kikan, itaku };
}
