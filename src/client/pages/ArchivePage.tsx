/**
 * アーカイブの画面（issue #9）。
 *
 * 所属: クライアント（画面）
 * 責務:
 *  - 商品の一覧を読み込み、発売月が当月より前の商品を、新しい月から順に年・月のグループ（見出しに個数と合計金額の実績）で表示する。
 *    商品のない月は表示しない。年のまとめ方（暦年・年度）はリストで選んだものを使う
 *  - 商品を押して編集のモーダルを開く（発売月は変更できない）。「リストに戻す」で新しい発売月を指定してリストに戻す
 *  - 保存・リストに戻した後に読み込み直す
 *  - リストと同じカテゴリーの選択で絞り込み、見出しの集計も絞り込んだ商品で数える（issue #10）
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProductListItem, ProductResponse } from '../../shared/productContract.ts';
import { CategoryFilterMenu, useCategoryFilter } from '../components/CategoryFilterMenu.tsx';
import { ProductEditorDialog } from '../components/ProductEditorDialog.tsx';
import { ProductGroupList } from '../components/ProductGroupList.tsx';
import { RestoreDialog } from '../components/RestoreDialog.tsx';
import { fetchProducts } from '../productApiClient.ts';
import { formatDateInJapan, formatMonthInJapan } from '../productDisplay.ts';
import { buildArchiveGroups, collectMakerSuggestions, formatArchiveSummary, splitProductsByArchive } from '../productList.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';
import { readStoredYearMode } from './ProductListPage.tsx';

/** 開いているモーダル。 */
type OpenDialog = { readonly kind: 'edit'; readonly product: ProductResponse } | { readonly kind: 'restore'; readonly product: ProductResponse };

/** ArchivePage の引数。 */
export type ArchivePageProps = {
  /** 現在時刻。日本時間の当月・今日の判定に使う。 */
  readonly currentTime: Date;
};

/** アーカイブの画面を描画する。 */
export function ArchivePage({ currentTime }: ArchivePageProps) {
  const [products, setProducts] = useState<ProductListItem[] | null>(null);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [yearMode] = useState(readStoredYearMode);
  const [openDialog, setOpenDialog] = useState<OpenDialog | null>(null);

  const today = formatDateInJapan(currentTime);
  const currentMonth = formatMonthInJapan(currentTime);

  const loadProducts = useCallback(async () => {
    try {
      setProducts(await fetchProducts());
      setHasLoadError(false);
    } catch {
      setHasLoadError(true);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const categoryFilter = useCategoryFilter(products ?? []);
  const archivedProducts = useMemo(
    () => splitProductsByArchive(categoryFilter.filteredProducts, currentMonth).archived,
    [categoryFilter.filteredProducts, currentMonth],
  );
  const yearGroups = useMemo(() => buildArchiveGroups(archivedProducts, { yearMode }), [archivedProducts, yearMode]);

  const makerSuggestions = useMemo(() => collectMakerSuggestions(products ?? []), [products]);

  const closeAndReload = () => {
    setOpenDialog(null);
    void loadProducts();
  };

  return (
    <div className="archive-page">
      <div className="toolbar">
        <CategoryFilterMenu
          options={categoryFilter.options}
          filter={categoryFilter.filter}
          onChange={categoryFilter.changeFilter}
          disabled={categoryFilter.categories === null}
        />
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

      {products !== null && archivedProducts.length === 0 && <p className="empty-archive">{SCREEN_MESSAGES.archiveEmpty}</p>}

      {products !== null && (
        <ProductGroupList
          yearGroups={yearGroups}
          formatSummary={formatArchiveSummary}
          today={today}
          onSelect={(selected) => setOpenDialog({ kind: 'edit', product: selected })}
          categories={categoryFilter.categories ?? null}
        />
      )}

      {openDialog?.kind === 'edit' && (
        <ProductEditorDialog
          key={openDialog.product.id}
          mode={{ kind: 'edit', product: openDialog.product }}
          onClose={() => setOpenDialog(null)}
          onSaved={closeAndReload}
          onRestoreRequested={() => setOpenDialog({ kind: 'restore', product: openDialog.product })}
          makerSuggestions={makerSuggestions}
          categories={categoryFilter.categories === undefined ? [] : categoryFilter.categories}
        />
      )}

      {openDialog?.kind === 'restore' && (
        <RestoreDialog product={openDialog.product} currentMonth={currentMonth} onClose={() => setOpenDialog(null)} onRestored={closeAndReload} />
      )}
    </div>
  );
}
