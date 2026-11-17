/**
 * 商品の一覧の画面。
 *
 * 所属: クライアント（画面）
 * 責務:
 *  - 商品の一覧を読み込み、年・月のグループ（見出しに個数と合計金額の見込み）で表示する。0 件の月も表示する
 *  - 年・月の折りたたみと、暦年・年度の切り替え（端末ごとに記憶）
 *  - ＋ボタンで追加、商品を押して編集・削除のモーダルを開き、保存後に読み込み直す
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProductResponse } from '../../shared/productContract.ts';
import { ProductCard } from '../components/ProductCard.tsx';
import { ProductEditorDialog, type ProductEditorMode } from '../components/ProductEditorDialog.tsx';
import { fetchProducts } from '../productApiClient.ts';
import { formatDateInJapan, formatMonthInJapan } from '../productDisplay.ts';
import { buildProductListGroups, formatGroupSummary, type YearMode } from '../productList.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';

/** 暦年・年度の切り替えを覚えておくための、ブラウザの保存領域のキー。 */
export const YEAR_MODE_STORAGE_KEY = 'waders.yearMode';

/** 保存されている年のまとめ方を読む。読めない・不正な値なら暦年。 */
function readStoredYearMode(): YearMode {
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

/** 集合に値があれば取り除き、なければ加えた新しい集合を返す。 */
function toggleSetValue(values: ReadonlySet<string>, value: string): Set<string> {
  const nextValues = new Set(values);
  if (nextValues.has(value)) nextValues.delete(value);
  else nextValues.add(value);
  return nextValues;
}

/** ProductListPage の引数。 */
export type ProductListPageProps = {
  /** 現在時刻。日本時間の当月・今日の判定に使う。 */
  readonly currentTime: Date;
};

/** 商品の一覧の画面を描画する。 */
export function ProductListPage({ currentTime }: ProductListPageProps) {
  const [products, setProducts] = useState<ProductResponse[] | null>(null);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [yearMode, setYearMode] = useState<YearMode>(readStoredYearMode);
  const [collapsedYearKeys, setCollapsedYearKeys] = useState<ReadonlySet<string>>(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<ReadonlySet<string>>(new Set());
  const [editorMode, setEditorMode] = useState<ProductEditorMode | null>(null);

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

  const yearGroups = useMemo(
    () => buildProductListGroups(products ?? [], { currentMonth, yearMode }),
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

      {products !== null &&
        yearGroups.map((yearGroup) => {
          const isYearExpanded = !collapsedYearKeys.has(yearGroup.key);
          return (
            <section key={yearGroup.key} className="year-group">
              <h2 className="year-heading">
                <button
                  type="button"
                  className="group-toggle"
                  aria-expanded={isYearExpanded}
                  onClick={() => setCollapsedYearKeys((current) => toggleSetValue(current, yearGroup.key))}
                >
                  <span className="group-caret" aria-hidden="true" />
                  <span className="group-label">{yearGroup.label}</span>{' '}
                  <span className="group-summary">{formatGroupSummary(yearGroup.summary)}</span>
                </button>
              </h2>
              {isYearExpanded &&
                yearGroup.months.map((monthGroup) => {
                  const isMonthExpanded = !collapsedMonths.has(monthGroup.month);
                  return (
                    <section key={monthGroup.month} className="month-group" aria-label={monthGroup.label}>
                      <h3 className="month-heading">
                        <button
                          type="button"
                          className="group-toggle"
                          aria-expanded={isMonthExpanded}
                          onClick={() => setCollapsedMonths((current) => toggleSetValue(current, monthGroup.month))}
                        >
                          <span className="group-caret" aria-hidden="true" />
                          <span className="group-label">{monthGroup.label}</span>{' '}
                          <span className="group-summary">{formatGroupSummary(monthGroup.summary)}</span>
                        </button>
                      </h3>
                      {isMonthExpanded && monthGroup.products.length === 0 && <p className="empty-month">{SCREEN_MESSAGES.emptyMonth}</p>}
                      {isMonthExpanded && monthGroup.products.length > 0 && (
                        <div className="product-grid">
                          {monthGroup.products.map((product) => (
                            <ProductCard
                              key={product.id}
                              product={product}
                              today={today}
                              onSelect={(selected) => setEditorMode({ kind: 'edit', product: selected })}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
            </section>
          );
        })}

      {editorMode !== null && (
        <ProductEditorDialog
          key={editorMode.kind === 'edit' ? editorMode.product.id : 'create'}
          mode={editorMode}
          onClose={() => setEditorMode(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
