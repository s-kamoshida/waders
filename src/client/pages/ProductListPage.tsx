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
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProductListItem, ProductResponse } from '../../shared/productContract.ts';
import { CategoryFilterMenu, useCategoryFilter } from '../components/CategoryFilterMenu.tsx';
import { ProductEditorDialog, type ProductEditorMode } from '../components/ProductEditorDialog.tsx';
import { NoticeToast, type Notice } from '../components/NoticeToast.tsx';
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
  const [notice, setNotice] = useState<Notice | null>(null);

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

  const handleSaved = () => {
    setEditorMode(null);
    void loadProducts();
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
          onSelect={(selected) => openEditor({ kind: 'edit', product: selected })}
          onAddToMonth={(month) => openEditor({ kind: 'create', defaultReleaseMonth: month })}
          onMoveProduct={(product, month) => void moveProduct(product, month)}
        />
      )}

      <NoticeToast notice={notice} onExpire={expireNotice} />

      {editorMode !== null && (
        <ProductEditorDialog
          key={editorMode.kind === 'edit' ? editorMode.product.id : `create-${editorMode.defaultReleaseMonth}`}
          mode={editorMode}
          onClose={() => setEditorMode(null)}
          onSaved={handleSaved}
          onSavedAndContinued={() => void loadProducts()}
          makerSuggestions={makerSuggestions}
          categories={categoryFilter.categories === undefined ? [] : categoryFilter.categories}
        />
      )}
    </div>
  );
}
