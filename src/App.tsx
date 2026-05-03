import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toPng } from "html-to-image";
import "./App.css";
import { computeSheetSections, type SheetSectionPlan } from "./layout";
import type { Book, Category } from "./types";
import { CATEGORY_LABEL } from "./types";

const STORAGE_KEY = "oshinagaki:v1";

const MM_TO_PX = 96 / 25.4;
const SHEET_W_MM = 297;
const SHEET_H_MM = 420;

function emptyBook(category: Category): Book {
  return {
    id: crypto.randomUUID(),
    category,
    title: "",
    summary: "",
    price: "",
    imageDataUrl: null,
  };
}

function loadBookImageFromFile(
  file: File,
  onResult: (dataUrl: string | null) => void
): void {
  if (!file.type.startsWith("image/")) {
    onResult(null);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    onResult(typeof reader.result === "string" ? reader.result : null);
  };
  reader.onerror = () => onResult(null);
  reader.readAsDataURL(file);
}

function booksByCategory(books: Book[]): Record<Category, Book[]> {
  return {
    shinpan: books.filter((b) => b.category === "shinpan"),
    kikan: books.filter((b) => b.category === "kikan"),
    itaku: books.filter((b) => b.category === "itaku"),
  };
}

function adjustBlock(books: Book[], category: Category, nextLen: number): Book[] {
  if (books.length === nextLen) return books;
  if (nextLen > books.length) {
    const add = Array.from({ length: nextLen - books.length }, () => emptyBook(category));
    return [...books, ...add];
  }
  return books.slice(0, nextLen);
}

function applyCounts(
  prev: Book[],
  counts: { shinpan: number; kikan: number; itaku: number }
): Book[] {
  const by = booksByCategory(prev);
  return [
    ...adjustBlock(by.shinpan, "shinpan", counts.shinpan),
    ...adjustBlock(by.kikan, "kikan", counts.kikan),
    ...adjustBlock(by.itaku, "itaku", counts.itaku),
  ];
}

/** プレビュー・印刷表示用。先頭に ¥ / ￥ がなければ ¥ を付ける */
function formatYenDisplay(raw: string): string {
  const s = raw.trim();
  if (!s) return "—";
  const normalized = s.replace(/^￥/, "¥");
  if (normalized.startsWith("¥")) return normalized;
  return `¥${normalized}`;
}

function displayTitleUnfocused(v: string): string {
  return v.trim().length > 0 ? v : "（タイトル未入力）";
}

function displaySummaryUnfocused(v: string): string {
  return v.length > 0 ? v : "—";
}

function displayCircleUnfocused(v: string): string {
  return v.trim().length > 0 ? v : "おしながき";
}

type EditableVariant = "circle" | "title" | "summary" | "price";

/** プレビュー専用。印刷は従来どおり静的ノードを使う */
function EditableInline({
  interactive,
  tag,
  className,
  value,
  onCommit,
  ariaLabel,
  readonlyChild,
  variant,
}: {
  interactive: boolean;
  tag: "h1" | "h3" | "p" | "div";
  className?: string;
  value: string;
  onCommit: (v: string) => void;
  ariaLabel: string;
  readonlyChild: React.ReactNode;
  variant: EditableVariant;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [focused, setFocused] = useState(false);

  const { unfocus, focusRaw } = useMemo(() => {
    switch (variant) {
      case "circle":
        return {
          unfocus: displayCircleUnfocused,
          focusRaw: (v: string) => v,
        };
      case "title":
        return { unfocus: displayTitleUnfocused, focusRaw: (v: string) => v };
      case "summary":
        return { unfocus: displaySummaryUnfocused, focusRaw: (v: string) => v };
      case "price":
        return { unfocus: formatYenDisplay, focusRaw: (v: string) => v };
    }
  }, [variant]);

  useLayoutEffect(() => {
    if (!interactive) return;
    const el = ref.current;
    if (!el) return;
    const next = focused ? focusRaw(value) : unfocus(value);
    if (el.textContent !== next) {
      el.textContent = next;
    }
  }, [interactive, value, focused, unfocus, focusRaw]);

  if (!interactive) {
    return createElement(tag, { ...(className ? { className } : {}) }, readonlyChild);
  }

  const role = tag === "div" || tag === "p" ? "textbox" : undefined;
  const ariaMultiline = tag === "div" ? true : undefined;

  return createElement(tag, {
    ref: (node: HTMLElement | null) => {
      ref.current = node;
    },
    ...(className ? { className } : {}),
    contentEditable: true,
    suppressContentEditableWarning: true,
    role,
    "aria-label": ariaLabel,
    "aria-multiline": ariaMultiline,
    onFocus: () => setFocused(true),
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      setFocused(false);
      onCommit((e.currentTarget.textContent ?? "").replace(/\u200b/g, ""));
    },
    onPaste: (e: React.ClipboardEvent<HTMLElement>) => {
      e.preventDefault();
      const t = e.clipboardData.getData("text/plain");
      if (typeof document.execCommand === "function") {
        document.execCommand("insertText", false, t);
      }
    },
  });
}

function loadState(): {
  circleName: string;
  counts: { shinpan: number; kikan: number; itaku: number };
  books: Book[];
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as {
      circleName?: string;
      counts?: { shinpan: number; kikan: number; itaku: number };
      books?: Book[];
    };
    if (!data.counts || !data.books) return null;
    return {
      circleName: data.circleName ?? "",
      counts: data.counts,
      books: data.books,
    };
  } catch {
    return null;
  }
}

function BookForm({
  book,
  index,
  onChange,
}: {
  book: Book;
  index: number;
  onChange: (next: Book) => void;
}) {
  const onImage = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      loadBookImageFromFile(file, (url) => {
        if (url) onChange({ ...book, imageDataUrl: url });
      });
    },
    [book, onChange]
  );

  return (
    <div className="book-card-form">
      <div className="book-card-form__head">
        <span className="book-card-form__badge">{CATEGORY_LABEL[book.category]}</span>
        <span className="book-card-form__index">#{index + 1}</span>
      </div>
      <div className="book-card-form__fields">
        <label>
          タイトル（改行可）
          <textarea
            className="book-card-form__textarea--title"
            value={book.title}
            onChange={(e) => onChange({ ...book, title: e.target.value })}
            placeholder="作品タイトル"
            rows={2}
          />
        </label>
        <label>
          概要
          <textarea
            value={book.summary}
            onChange={(e) => onChange({ ...book, summary: e.target.value })}
            placeholder="あらすじ・内容紹介など"
          />
        </label>
        <label>
          価格
          <input
            value={book.price}
            onChange={(e) => onChange({ ...book, price: e.target.value })}
            placeholder="¥500 など"
          />
        </label>
        <label>
          表紙画像
          <div className="book-card-form__image">
            <input type="file" accept="image/*" onChange={onImage} />
            {book.imageDataUrl ? (
              <img className="book-card-form__thumb" src={book.imageDataUrl} alt="" />
            ) : null}
          </div>
        </label>
      </div>
    </div>
  );
}

function sheetSectionTitleClass(cat: Category): string {
  if (cat === "shinpan") return "sheet-section__title";
  if (cat === "kikan") return "sheet-section__title sheet-section__title--kikan";
  return "sheet-section__title sheet-section__title--itaku";
}

function pbookModifierClass(cat: Category): string {
  if (cat === "shinpan") return "pbook--shinpan";
  if (cat === "kikan") return "pbook--kikan";
  return "pbook--itaku";
}

function SheetSection({
  plan,
  interactive = false,
  onBookPatch,
}: {
  plan: SheetSectionPlan;
  interactive?: boolean;
  onBookPatch?: (id: string, patch: Partial<Book>) => void;
}) {
  const { books, cols, rows, flexGrow, category } = plan;
  const title = CATEGORY_LABEL[category];
  const titleClass = sheetSectionTitleClass(category);
  const catClass = pbookModifierClass(category);

  return (
    <section
      className={`sheet-section sheet-section--${category}`}
      style={{
        flexGrow,
        flexShrink: 1,
        flexBasis: 0,
        minHeight: 0,
      }}
    >
      <h2 className={titleClass}>{title}</h2>
      <div
        className="sheet-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          gap: "2mm",
        }}
      >
        {books.map((b) => (
          <article key={b.id} className={`pbook ${catClass}`}>
            {interactive && onBookPatch ? (
              <div className="pbook__cover-slot">
                <input
                  id={`oshinagaki-cover-${b.id}`}
                  type="file"
                  accept="image/*"
                  className="pbook__cover-file-input"
                  aria-label={`${CATEGORY_LABEL[b.category]}の表紙画像を選択`}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    loadBookImageFromFile(file, (url) => {
                      if (url) onBookPatch(b.id, { imageDataUrl: url });
                    });
                  }}
                />
                {b.imageDataUrl ? (
                  <>
                    <img
                      className="pbook__cover-img"
                      src={b.imageDataUrl}
                      alt=""
                    />
                    <div className="pbook__cover-slot-footer">
                      <label
                        htmlFor={`oshinagaki-cover-${b.id}`}
                        className="pbook__cover-insert-btn"
                      >
                        画像を挿入
                      </label>
                    </div>
                  </>
                ) : (
                  <div className="pbook__cover-empty">
                    <label
                      htmlFor={`oshinagaki-cover-${b.id}`}
                      className="pbook__cover-insert-btn"
                    >
                      画像を挿入
                    </label>
                  </div>
                )}
              </div>
            ) : b.imageDataUrl ? (
              <img className="pbook__cover" src={b.imageDataUrl} alt="" />
            ) : (
              <div
                className="pbook__cover pbook__placeholder"
                aria-hidden
              >
                表紙
              </div>
            )}
            <div className="pbook__body">
              <div className="pbook__headline">
                <EditableInline
                  interactive={interactive}
                  tag="h3"
                  className="pbook__title"
                  value={b.title}
                  variant="title"
                  ariaLabel={`${CATEGORY_LABEL[b.category]}のタイトル`}
                  readonlyChild={b.title || "（タイトル未入力）"}
                  onCommit={(next) => onBookPatch?.(b.id, { title: next })}
                />
                <EditableInline
                  interactive={interactive}
                  tag="p"
                  className="pbook__price"
                  value={b.price}
                  variant="price"
                  ariaLabel="価格"
                  readonlyChild={formatYenDisplay(b.price)}
                  onCommit={(next) => onBookPatch?.(b.id, { price: next.trim() })}
                />
              </div>
              <EditableInline
                interactive={interactive}
                tag="div"
                className="pbook__summary"
                value={b.summary}
                variant="summary"
                ariaLabel="概要"
                readonlyChild={b.summary || "—"}
                onCommit={(next) => onBookPatch?.(b.id, { summary: next })}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function OshinagakiSheet({
  circleName,
  books,
  interactive = false,
  onCircleNameChange,
  onBookPatch,
}: {
  circleName: string;
  books: Book[];
  interactive?: boolean;
  onCircleNameChange?: (next: string) => void;
  onBookPatch?: (id: string, patch: Partial<Book>) => void;
}) {
  const sections = useMemo(() => computeSheetSections(books), [books]);

  return (
    <div className="sheet-outer">
      <div className={`sheet${interactive ? " sheet--interactive" : ""}`}>
        <header className="sheet__masthead">
          <EditableInline
            interactive={interactive}
            tag="h1"
            value={circleName}
            variant="circle"
            ariaLabel="サークル名・見出し"
            readonlyChild={displayCircleUnfocused(circleName)}
            onCommit={(next) => onCircleNameChange?.(next)}
          />
        </header>
        <div className="sheet-body">
          {sections.map((plan) => (
            <SheetSection
              key={plan.category}
              plan={plan}
              interactive={interactive}
              onBookPatch={onBookPatch}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const initial = loadState();
  const [circleName, setCircleName] = useState(initial?.circleName ?? "");
  const [counts, setCounts] = useState(
    initial?.counts ?? { shinpan: 1, kikan: 0, itaku: 0 }
  );
  const [books, setBooks] = useState<Book[]>(() => {
    if (initial?.books?.length) return initial.books;
    return applyCounts([], { shinpan: 1, kikan: 0, itaku: 0 });
  });

  const [draftCounts, setDraftCounts] = useState(counts);

  const by = useMemo(() => booksByCategory(books), [books]);

  const updateBook = useCallback((id: string, next: Book) => {
    setBooks((prev) => prev.map((b) => (b.id === id ? next : b)));
  }, []);

  const patchBook = useCallback((id: string, patch: Partial<Book>) => {
    setBooks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...patch } : b))
    );
  }, []);

  const applySlotCounts = useCallback(() => {
    const next = {
      shinpan: Math.max(0, Math.min(24, Math.round(draftCounts.shinpan))),
      kikan: Math.max(0, Math.min(36, Math.round(draftCounts.kikan))),
      itaku: Math.max(0, Math.min(36, Math.round(draftCounts.itaku))),
    };
    setCounts(next);
    setDraftCounts(next);
    setBooks((prev) => applyCounts(prev, next));
  }, [draftCounts]);

  useEffect(() => {
    const payload = JSON.stringify({ circleName, counts, books });
    localStorage.setItem(STORAGE_KEY, payload);
  }, [circleName, counts, books]);

  const scaleWrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const printRootRef = useRef<HTMLDivElement>(null);
  const imageExportLockRef = useRef(false);
  const [previewScale, setPreviewScale] = useState(0.42);
  const [imageExporting, setImageExporting] = useState(false);

  useEffect(() => {
    const el = scaleWrapRef.current;
    const inner = innerRef.current;
    if (!el || !inner) return;

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 8;
      const natural = SHEET_W_MM * MM_TO_PX;
      const s = Math.min(1, Math.max(0.22, w / natural));
      setPreviewScale(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handlePrint = () => window.print();

  const handleExportImage = useCallback(async () => {
    const root = printRootRef.current;
    const sheet = root?.querySelector<HTMLElement>(".sheet-outer");
    if (!root || !sheet || imageExportLockRef.current) return;
    imageExportLockRef.current = true;
    setImageExporting(true);
    root.classList.add("print-root--capture-ready");
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        /* ignore */
      }
    }
    try {
      const dataUrl = await toPng(sheet, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#fffef9",
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `oshinagaki-${stamp}.png`;
      a.rel = "noopener";
      a.click();
    } catch (e) {
      console.error(e);
      window.alert(
        "画像の作成に失敗しました。しばらく待ってから再度お試しください。"
      );
    } finally {
      root.classList.remove("print-root--capture-ready");
      imageExportLockRef.current = false;
      setImageExporting(false);
    }
  }, []);

  return (
    <div className="app">
      <header className="app__header no-print">
        <h1 className="app__title">おしながきメーカー</h1>
        <p className="app__lead">
          冊数を決めてスロットを更新すると、A3 用の配置が自動で決まります。ブラウザからそのまま印刷できます。
        </p>
      </header>

      <div className="app__grid">
        <div className="no-print">
          <div className="panel">
            <h2 className="panel__title">表示・冊数</h2>
            <label>
              <span className="counts__label">見出し</span>
              <input
                style={{ width: "100%", marginTop: 4, padding: "0.4rem 0.5rem", borderRadius: 8, border: "1px solid var(--line)" }}
                value={circleName}
                onChange={(e) => setCircleName(e.target.value)}
                placeholder="サークル名・おしながきのタイトル"
              />
            </label>
            <div className="counts" style={{ marginTop: "0.85rem" }}>
              <div className="counts__row">
                <span className="counts__label counts__label--shinpan">新刊</span>
                <input
                  type="number"
                  min={0}
                  max={24}
                  value={draftCounts.shinpan}
                  onChange={(e) =>
                    setDraftCounts((d) => ({ ...d, shinpan: Number(e.target.value) }))
                  }
                />
                <span className="counts__hint">最大 24</span>
              </div>
              <div className="counts__row">
                <span className="counts__label">既刊</span>
                <input
                  type="number"
                  min={0}
                  max={36}
                  value={draftCounts.kikan}
                  onChange={(e) =>
                    setDraftCounts((d) => ({ ...d, kikan: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="counts__row">
                <span className="counts__label">委託</span>
                <input
                  type="number"
                  min={0}
                  max={36}
                  value={draftCounts.itaku}
                  onChange={(e) =>
                    setDraftCounts((d) => ({ ...d, itaku: Number(e.target.value) }))
                  }
                />
              </div>
              <button type="button" className="counts__apply" onClick={applySlotCounts}>
                スロットを更新（レイアウト再計算）
              </button>
              <p className="counts__hint">
                現在: 新刊 {counts.shinpan} / 既刊 {counts.kikan} / 委託 {counts.itaku}
              </p>
            </div>
          </div>

          <div className="panel book-list">
            <h2 className="panel__title">新刊の登録</h2>
            {by.shinpan.map((b, i) => (
              <BookForm key={b.id} book={b} index={i} onChange={(next) => updateBook(b.id, next)} />
            ))}
          </div>

          <div className="panel book-list">
            <h2 className="panel__title">既刊の登録</h2>
            {by.kikan.length === 0 ? (
              <p className="counts__hint">冊数 0 のときは表示されません。</p>
            ) : (
              by.kikan.map((b, i) => (
                <BookForm key={b.id} book={b} index={i} onChange={(next) => updateBook(b.id, next)} />
              ))
            )}
          </div>

          <div className="panel book-list">
            <h2 className="panel__title">委託の登録</h2>
            {by.itaku.length === 0 ? (
              <p className="counts__hint">冊数 0 のときは表示されません。</p>
            ) : (
              by.itaku.map((b, i) => (
                <BookForm key={b.id} book={b} index={i} onChange={(next) => updateBook(b.id, next)} />
              ))
            )}
          </div>
        </div>

        <div className="preview-wrap no-print">
          <div className="preview-toolbar">
            <button type="button" className="primary" onClick={handlePrint}>
              A3 で印刷
            </button>
            <button
              type="button"
              onClick={handleExportImage}
              disabled={imageExporting}
            >
              {imageExporting ? "画像を作成中…" : "画像として保存"}
            </button>
          </div>
          <div className="preview-scale" ref={scaleWrapRef}>
            <div
              style={{
                width: SHEET_W_MM * MM_TO_PX * previewScale,
                height: SHEET_H_MM * MM_TO_PX * previewScale,
              }}
            >
              <div
                className="preview-scale__inner"
                ref={innerRef}
                style={{
                  width: SHEET_W_MM * MM_TO_PX,
                  height: SHEET_H_MM * MM_TO_PX,
                  transform: `scale(${previewScale})`,
                }}
              >
                <OshinagakiSheet
                  circleName={circleName}
                  books={books}
                  interactive
                  onCircleNameChange={setCircleName}
                  onBookPatch={patchBook}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="print-root" id="oshinagaki-print" ref={printRootRef}>
        <OshinagakiSheet circleName={circleName} books={books} />
      </div>
    </div>
  );
}
