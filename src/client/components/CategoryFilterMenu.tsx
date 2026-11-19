/**
 * カテゴリーの絞り込み（リストとアーカイブで共用）。
 *
 * 所属: クライアント（画面の部品）
 * 責務（issue #10）:
 *  - カテゴリーの定義を読み込み、絞り込みの選択肢（定義の並び順、定義にないカテゴリー、カテゴリー未設定）を作る
 *  - 選んだカテゴリーを端末（ブラウザ）ごとに覚え、選択肢にないものは選んでいないものとして扱う
 *  - 定義に誤りがある場合は理由を返し、絞り込みを使えなくする（商品はすべて表示する）
 *  - 絞り込みのプルダウン（ボタンと、チェックボックスの一覧）を描画する
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CategoryResponse } from '../../shared/categoryContract.ts';
import type { ProductResponse } from '../../shared/productContract.ts';
import { ApiRequestError, fetchCategories } from '../productApiClient.ts';
import {
  buildCategoryFilterOptions,
  filterProductsByCategory,
  isCategoryFilterEmpty,
  type CategoryFilter,
  type CategoryFilterOption,
} from '../productList.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';

/** 選んだカテゴリーを覚えておくための、ブラウザの保存領域のキー。 */
export const CATEGORY_FILTER_STORAGE_KEY = 'waders.categoryFilter';

const EMPTY_FILTER: CategoryFilter = { categoryIds: new Set(), includesUncategorized: false };

/** 保存されている選択を読む。読めない・不正な値なら、何も選んでいないものとする。 */
function readStoredCategoryFilter(): CategoryFilter {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CATEGORY_FILTER_STORAGE_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_FILTER;
    const { categoryIds, includesUncategorized } = parsed as Record<string, unknown>;
    return {
      categoryIds: new Set(Array.isArray(categoryIds) ? categoryIds.filter((value): value is string => typeof value === 'string') : []),
      includesUncategorized: includesUncategorized === true,
    };
  } catch {
    return EMPTY_FILTER;
  }
}

/** 選択を保存する。保存できなくても画面の動作は続ける。 */
function storeCategoryFilter(filter: CategoryFilter): void {
  try {
    localStorage.setItem(
      CATEGORY_FILTER_STORAGE_KEY,
      JSON.stringify({ categoryIds: [...filter.categoryIds], includesUncategorized: filter.includesUncategorized }),
    );
  } catch {
    // プライベートブラウズなどで保存できない場合は、記憶しないだけにする
  }
}

/** useCategoryFilter の結果。 */
export type CategoryFilterState<Item extends ProductResponse> = {
  /** 定義のカテゴリー。読み込み中は undefined、定義に誤りがある・読めない場合は null。 */
  readonly categories: readonly CategoryResponse[] | null | undefined;
  /** 定義を読めなかった理由（表示用）。読めた場合は null。 */
  readonly categoryErrorMessage: string | null;
  readonly options: readonly CategoryFilterOption[];
  /** 選択肢にあるものだけに絞った、今の選択。 */
  readonly filter: CategoryFilter;
  readonly changeFilter: (filter: CategoryFilter) => void;
  /** 絞り込んだ商品。定義を読めない場合はすべての商品。 */
  readonly filteredProducts: Item[];
};

/**
 * カテゴリーの定義を読み込み、商品を覚えている選択で絞り込む。
 * @param products 読み込んだ商品（アーカイブを含めてもよい。定義にないカテゴリーの選択肢を作るのに使う）
 */
export function useCategoryFilter<Item extends ProductResponse>(products: readonly Item[]): CategoryFilterState<Item> {
  const [categories, setCategories] = useState<readonly CategoryResponse[] | null | undefined>(undefined);
  const [categoryErrorMessage, setCategoryErrorMessage] = useState<string | null>(null);
  const [storedFilter, setStoredFilter] = useState<CategoryFilter>(readStoredCategoryFilter);

  useEffect(() => {
    let isActive = true;
    fetchCategories()
      .then((loaded) => {
        if (isActive) setCategories(loaded);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        setCategories(null);
        const isDefinitionError = error instanceof ApiRequestError && error.code === 'CATEGORY_DEFINITION_INVALID';
        setCategoryErrorMessage(
          isDefinitionError ? `${error.message} ${SCREEN_MESSAGES.categoryDefinitionFixHint}` : SCREEN_MESSAGES.categoryDefinitionLoadFailed,
        );
      });
    return () => {
      isActive = false;
    };
  }, []);

  const options = useMemo(() => (categories == null ? [] : buildCategoryFilterOptions(categories, products)), [categories, products]);
  const filter = useMemo<CategoryFilter>(() => {
    if (categories === null) return EMPTY_FILTER;
    // 読み込み中は、覚えている選択のまま絞り込む（読み込み終わるまで、すべての商品が一瞬見えないようにするため）
    if (categories === undefined) return storedFilter;
    const optionIds = new Set(options.map((option) => option.id));
    return {
      categoryIds: new Set([...storedFilter.categoryIds].filter((categoryId) => optionIds.has(categoryId))),
      includesUncategorized: storedFilter.includesUncategorized,
    };
  }, [categories, options, storedFilter]);
  const filteredProducts = useMemo(() => filterProductsByCategory(products, filter), [products, filter]);

  const changeFilter = useCallback((nextFilter: CategoryFilter) => {
    setStoredFilter(nextFilter);
    storeCategoryFilter(nextFilter);
  }, []);

  return { categories, categoryErrorMessage, options, filter, changeFilter, filteredProducts };
}

/** CategoryFilterMenu の引数。 */
export type CategoryFilterMenuProps = {
  readonly options: readonly CategoryFilterOption[];
  readonly filter: CategoryFilter;
  readonly onChange: (filter: CategoryFilter) => void;
  /** 定義に誤りがある場合など、使えないときは true。 */
  readonly disabled: boolean;
};

/** ボタンの表記（例: 「カテゴリー: スケールフィギュア、カテゴリー未設定」）。 */
function formatFilterLabel(options: readonly CategoryFilterOption[], filter: CategoryFilter): string {
  if (isCategoryFilterEmpty(filter)) return 'カテゴリー: すべて';
  const labels = options.filter((option) => filter.categoryIds.has(option.id)).map((option) => option.label);
  if (filter.includesUncategorized) labels.push(SCREEN_MESSAGES.uncategorized);
  return `カテゴリー: ${labels.join('、')}`;
}

/** 絞り込みのプルダウンを描画する。外を押す・Esc キーで閉じる。 */
export function CategoryFilterMenu({ options, filter, onChange, disabled }: CategoryFilterMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && containerRef.current?.contains(event.target)) return;
      setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [isOpen]);

  const toggleCategory = (categoryId: string) => {
    const categoryIds = new Set(filter.categoryIds);
    if (categoryIds.has(categoryId)) categoryIds.delete(categoryId);
    else categoryIds.add(categoryId);
    onChange({ ...filter, categoryIds });
  };

  return (
    <div
      ref={containerRef}
      className="category-filter"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) setIsOpen(false);
      }}
    >
      <button
        type="button"
        className={isCategoryFilterEmpty(filter) ? 'category-filter-button' : 'category-filter-button category-filter-button--active'}
        aria-expanded={isOpen}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        {formatFilterLabel(options, filter)}
      </button>
      {isOpen && (
        <div id={panelId} className="category-filter-panel" role="group" aria-label="カテゴリーで絞り込む">
          {options.map((option) => (
            <label key={option.id} className="category-filter-option">
              <input type="checkbox" checked={filter.categoryIds.has(option.id)} onChange={() => toggleCategory(option.id)} />
              {option.label}
            </label>
          ))}
          <div className="category-filter-divider" />
          <label className="category-filter-option">
            <input
              type="checkbox"
              checked={filter.includesUncategorized}
              onChange={() => onChange({ ...filter, includesUncategorized: !filter.includesUncategorized })}
            />
            {SCREEN_MESSAGES.uncategorized}
          </label>
          <div className="category-filter-divider" />
          <button type="button" className="category-filter-clear" onClick={() => onChange(EMPTY_FILTER)}>
            {SCREEN_MESSAGES.categoryFilterClear}
          </button>
        </div>
      )}
    </div>
  );
}
