/**
 * 商品の一覧の画面。
 *
 * 所属: クライアント（画面）
 * 責務:
 *  - 商品の一覧を読み込み、発売月が当月以降の商品を年・月のグループ（見出しに個数と合計金額の見込み）で表示する。
 *    0 件の月も表示する。当月より前の商品はアーカイブの画面に表示する（issue #9）
 *  - 年・月の折りたたみと、暦年・年度の切り替え（端末ごとに記憶）
 *  - ＋ボタン・月の見出しの＋ボタン（その月を発売月にする。issue #16）で追加、商品を押して編集・削除のモーダルを開き、保存後に読み込み直す
 *  - 「保存して続けて追加」で保存した場合は、モーダルを開いたまま読み込み直す（issue #16）
 *  - カテゴリーで絞り込む（選択は端末ごとに覚え、見出しの集計も絞り込んだ商品で数える。issue #10）
 *  - ドラッグアンドドロップで発売月を移動し、知らせ（「元に戻す」付き）を出す。ほかの操作を始めたら知らせを閉じる（issue #13）
 *  - カード画像を取りに行っている商品があれば、2 秒ごとに読み直す。なくなったら止め、取れないままでも 30 秒であきらめる（issue #42）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProductListItem, ProductResponse } from '../../shared/productContract.ts';
import { CategoryFilterMenu, useCategoryFilter } from '../components/CategoryFilterMenu.tsx';
import { ProductEditorDialog, type ProductEditorMode, type ProductSavedResult } from '../components/ProductEditorDialog.tsx';
import { NoticeToast, type Notice } from '../components/NoticeToast.tsx';
import { ProductDetailDialog } from '../components/ProductDetailDialog.tsx';
import { ProductGroupList } from '../components/ProductGroupList.tsx';
import { fetchProducts, moveProductToReleaseMonth } from '../productApiClient.ts';
import { formatDateInJapan, formatMonthInJapan } from '../productDisplay.ts';
import {
  buildProductListGroups,
  collectMakerSuggestions,
  formatGroupSummary,
  splitProductsByArchive,
  type YearMode,
} from '../productList.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';

/** 暦年・年度の切り替えを覚えておくための、ブラウザの保存領域のキー。 */
export const YEAR_MODE_STORAGE_KEY = 'waders.yearMode';

export { CATEGORY_FILTER_STORAGE_KEY } from '../components/CategoryFilterMenu.tsx';

/** 保存されている年のまとめ方を読む。読めない・不正な値なら暦年。アーカイブの画面でも使う。 */
export function readStoredYearMode(): YearMode {
  try {
    const storedValue = localStorage.getItem(YEAR_MODE_STORAGE_KEY);
    return storedValue === 'fiscal' ? 'fiscal' : 'calendar';
  } catch {
    return 'calendar';
  }
}

/** 年のまとめ方を保存する。保存できなくても画面の動作は続ける。 */
function storeYearMode(yearMode: YearMode): void {
  try {
    localStorage.setItem(YEAR_MODE_STORAGE_KEY, yearMode);
  } catch {
    // プライベートブラウズなどで保存できない場合は、記憶しないだけにする
  }
}

/** カード画像を取りに行っている間に一覧を読み直す間隔（ミリ秒。issue #42）。 */
const CARD_IMAGE_POLL_INTERVAL_MILLISECONDS = 2000;
/** カード画像を待って読み直す回数の上限（2 秒ごとに 30 秒まで）。 */
const MAXIMUM_CARD_IMAGE_POLL_COUNT = 15;

/** ProductListPage の引数。 */
export type ProductListPageProps = {
  /** 現在時刻。日本時間の当月・今日の判定に使う。 */
  readonly currentTime: Date;
  /** 一覧を読み込んだときに、読み込んだすべての商品（アーカイブを含む）を渡す。同じ関数を渡し続けること。 */
  readonly onProductsLoaded?: (products: readonly ProductListItem[]) => void;
};

/** 商品の一覧の画面を描画する。 */
export function ProductListPage({ currentTime, onProductsLoaded }: ProductListPageProps) {
  const [products, setProducts] = useState<ProductListItem[] | null>(null);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [yearMode, setYearMode] = useState<YearMode>(readStoredYearMode);
  const [editorMode, setEditorMode] = useState<ProductEditorMode | null>(null);
  /** 詳細画面で開いている商品（issue #52）。 */
  const [detailProduct, setDetailProduct] = useState<ProductResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** カード画像を待って読み直した回数（取りに行っている商品がなくなる・保存すると数え直す）。 */
  const cardImagePollCountRef = useRef(0);

  const today = formatDateInJapan(currentTime);
  const currentMonth = formatMonthInJapan(currentTime);

  const loadProducts = useCallback(async () => {
    try {
      const loadedProducts = await fetchProducts();
      setProducts(loadedProducts);
      setHasLoadError(false);
      onProductsLoaded?.(loadedProducts);
    } catch {
      setHasLoadError(true);
    }
  }, [onProductsLoaded]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const hasPendingCardImage = products?.some((product) => product.cardImagePending) ?? false;
  useEffect(() => {
    if (!hasPendingCardImage) {
      cardImagePollCountRef.current = 0;
      return;
    }
    if (cardImagePollCountRef.current >= MAXIMUM_CARD_IMAGE_POLL_COUNT) return;
    const timer = setTimeout(() => {
      cardImagePollCountRef.current += 1;
      void loadProducts();
    }, CARD_IMAGE_POLL_INTERVAL_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [products, hasPendingCardImage, loadProducts]);

  /** 保存した後に読み込み直す。新しくカード画像を取りに行くかもしれないため、待つ回数を数え直す（issue #42）。 */
  const reloadAfterSave = () => {
    cardImagePollCountRef.current = 0;
    void loadProducts();
  };

  const categoryFilter = useCategoryFilter(products ?? []);
  const yearGroups = useMemo(
    () => buildProductListGroups(splitProductsByArchive(categoryFilter.filteredProducts, currentMonth).active, { currentMonth, yearMode }),
    [categoryFilter.filteredProducts, currentMonth, yearMode],
  );

  const makerSuggestions = useMemo(() => collectMakerSuggestions(products ?? []), [products]);

  /** 追加・編集のモーダルを開く。ほかの操作を始めたので、移動の知らせは閉じる（issue #13）。 */
  const openEditor = (mode: ProductEditorMode) => {
    setNotice(null);
    setEditorMode(mode);
  };

  /** 商品の詳細画面を開く（issue #52）。ほかの操作を始めたので、移動の知らせは閉じる（issue #13）。 */
  const openDetail = (product: ProductResponse) => {
    setNotice(null);
    setDetailProduct(product);
  };

  /** 詳細画面の「編集」。詳細画面の代わりに編集のモーダルを開く（保存・キャンセルの後は一覧に戻る。issue #52）。 */
  const switchDetailToEditor = (product: ProductResponse) => {
    setDetailProduct(null);
    openEditor({ kind: 'edit', product });
  };

  /** 詳細画面から削除した。詳細画面を閉じて読み込み直す（issue #52）。 */
  const handleDeletedFromDetail = () => {
    setDetailProduct(null);
    reloadAfterSave();
  };

  const changeYearMode = (nextYearMode: YearMode) => {
    setNotice(null);
    setYearMode(nextYearMode);
    storeYearMode(nextYearMode);
  };

  const expireNotice = useCallback((expired: Notice) => {
    setNotice((current) => (current === expired ? null : current));
  }, []);

  /** 発売月を移動して知らせる。元に戻す場合は、知らせに「元に戻す」を付けない。 */
  const moveProduct = useCallback(
    async (product: ProductResponse, month: string, isUndo = false) => {
      try {
        await moveProductToReleaseMonth(product.id, month);
        const monthLabel = month.replace('-', '/');
        setNotice(
          isUndo
            ? { kind: 'success', message: SCREEN_MESSAGES.productMoveUndone(monthLabel) }
            : {
                kind: 'success',
                message: SCREEN_MESSAGES.productMoved(monthLabel),
                action: {
                  label: SCREEN_MESSAGES.undo,
                  onPress: () => void moveProduct({ ...product, releaseMonth: month }, product.releaseMonth, true),
                },
              },
        );
        void loadProducts();
      } catch {
        setNotice({ kind: 'error', message: SCREEN_MESSAGES.productMoveFailed });
      }
    },
    [loadProducts],
  );

  /** 保存した後にモーダルを閉じて読み込み直す。画像を保存できなかった場合は知らせる（issue #41）。 */
  const handleSaved = (result?: ProductSavedResult) => {
    setEditorMode(null);
    if (result?.imageSaveFailed === true) setNotice({ kind: 'success', message: SCREEN_MESSAGES.productImageSaveFailed });
    reloadAfterSave();
  };

  return (
    <div className="product-list-page">
      <div className="toolbar">
        <CategoryFilterMenu
          options={categoryFilter.options}
          filter={categoryFilter.filter}
          onChange={(nextFilter) => {
            setNotice(null);
            categoryFilter.changeFilter(nextFilter);
          }}
          disabled={categoryFilter.categories === null}
        />
        <div className="segmented" role="radiogroup" aria-label="年のまとめ方">
          {(
            [
              ['calendar', '暦年'],
              ['fiscal', '年度'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={yearMode === value ? 'segmented-option segmented-option--selected' : 'segmented-option'}>
              <input
                type="radio"
                name="year-mode"
                value={value}
                checked={yearMode === value}
                onChange={() => changeYearMode(value)}
              />
              {label}
            </label>
          ))}
        </div>
        <span className="toolbar-spacer" />
        <button
          type="button"
          className="add-button"
          aria-label="商品を追加"
          onClick={() => openEditor({ kind: 'create', defaultReleaseMonth: currentMonth })}
        >
          ＋
        </button>
      </div>

      {hasLoadError && (
        <p role="alert" className="page-error">
          {SCREEN_MESSAGES.productListLoadFailed}
        </p>
      )}
      {categoryFilter.categoryErrorMessage !== null && (
        <p role="alert" className="page-error">
          {categoryFilter.categoryErrorMessage}
        </p>
      )}

      {products !== null && (
        <ProductGroupList
          yearGroups={yearGroups}
          formatSummary={formatGroupSummary}
          today={today}
          onSelect={openDetail}
          onAddToMonth={(month) => openEditor({ kind: 'create', defaultReleaseMonth: month })}
          onMoveProduct={(product, month) => void moveProduct(product, month)}
          categories={categoryFilter.categories ?? null}
        />
      )}

      <NoticeToast notice={notice} onExpire={expireNotice} />

      {detailProduct !== null && (
        <ProductDetailDialog
          key={detailProduct.id}
          product={detailProduct}
          categories={categoryFilter.categories ?? null}
          onClose={() => setDetailProduct(null)}
          onEditRequested={() => switchDetailToEditor(detailProduct)}
          onDeleted={handleDeletedFromDetail}
          onStatusChanged={reloadAfterSave}
        />
      )}

      {editorMode !== null && (
        <ProductEditorDialog
          key={editorMode.kind === 'edit' ? editorMode.product.id : `create-${editorMode.defaultReleaseMonth}`}
          mode={editorMode}
          onClose={() => setEditorMode(null)}
          onSaved={handleSaved}
          onSavedAndContinued={reloadAfterSave}
          makerSuggestions={makerSuggestions}
          categories={categoryFilter.categories === undefined ? [] : categoryFilter.categories}
        />
      )}
    </div>
  );
}
