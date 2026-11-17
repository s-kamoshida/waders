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
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProductListItem } from '../../shared/productContract.ts';
import { ProductEditorDialog, type ProductEditorMode } from '../components/ProductEditorDialog.tsx';
import { ProductGroupList } from '../components/ProductGroupList.tsx';
import { fetchProducts } from '../productApiClient.ts';
import { formatDateInJapan, formatMonthInJapan } from '../productDisplay.ts';
import { buildProductListGroups, formatGroupSummary, splitProductsByArchive, type YearMode } from '../productList.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';

/** 暦年・年度の切り替えを覚えておくための、ブラウザの保存領域のキー。 */
export const YEAR_MODE_STORAGE_KEY = 'waders.yearMode';

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

  const yearGroups = useMemo(
    () => buildProductListGroups(splitProductsByArchive(products ?? [], currentMonth).active, { currentMonth, yearMode }),
    [products, currentMonth, yearMode],
  );

  const changeYearMode = (nextYearMode: YearMode) => {
    setYearMode(nextYearMode);
    storeYearMode(nextYearMode);
  };

  const handleSaved = () => {
    setEditorMode(null);
    void loadProducts();
  };

  return (
    <div className="product-list-page">
      <div className="toolbar">
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
          onClick={() => setEditorMode({ kind: 'create', defaultReleaseMonth: currentMonth })}
        >
          ＋
        </button>
      </div>

      {hasLoadError && (
        <p role="alert" className="page-error">
          {SCREEN_MESSAGES.productListLoadFailed}
        </p>
      )}

      {products !== null && (
        <ProductGroupList
          yearGroups={yearGroups}
          formatSummary={formatGroupSummary}
          today={today}
          onSelect={(selected) => setEditorMode({ kind: 'edit', product: selected })}
          onAddToMonth={(month) => setEditorMode({ kind: 'create', defaultReleaseMonth: month })}
        />
      )}

      {editorMode !== null && (
        <ProductEditorDialog
          key={editorMode.kind === 'edit' ? editorMode.product.id : `create-${editorMode.defaultReleaseMonth}`}
          mode={editorMode}
          onClose={() => setEditorMode(null)}
          onSaved={handleSaved}
          onSavedAndContinued={() => void loadProducts()}
        />
      )}
    </div>
  );
}
