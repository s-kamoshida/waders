/**
 * 一覧の組み立て（リストとアーカイブの振り分け、年・月のグループ、並び順、見出しの集計）。
 *
 * 所属: クライアント
 * 責務: 商品の一覧を、画面に表示する年・月のグループに組み立てる純粋な関数（要件「リストの構成」「アーカイブ」）。
 */
import type { CategoryResponse } from '../shared/categoryContract.ts';
import type { ProductResponse } from '../shared/productContract.ts';
import { formatYen } from './productDisplay.ts';

/** 年のまとめ方。calendar は暦年（1月〜12月）、fiscal は年度（4月〜翌3月）。 */
export type YearMode = 'calendar' | 'fiscal';

/** 見出しの集計。未購入を除いた個数と、金額と送料の合計（金額が未入力の商品は個数だけに含める）。 */
export type GroupSummary = { readonly count: number; readonly totalYen: number };

/** 月のグループ。 */
export type MonthGroup = {
  /** 年月（YYYY-MM）。 */
  readonly month: string;
  /** 表記（例: 2026/11）。 */
  readonly label: string;
  /** 並び替え済みの商品。 */
  readonly products: readonly ProductResponse[];
  readonly summary: GroupSummary;
};

/** 年のグループ。 */
export type YearGroup = {
  readonly key: string;
  /** 表記（例: 2026年、FY26）。 */
  readonly label: string;
  readonly months: readonly MonthGroup[];
  readonly summary: GroupSummary;
};

/** 同じ月の中の並び順（小さいほど上）。購入済 → 予約済 → 予約済（キャンセル可）→ 検討中 → 未購入。 */
function rankProduct(product: ProductResponse): number {
  if (product.status === 'purchased') return 0;
  if (product.status === 'reserved') return product.cancelable ? 2 : 1;
  if (product.status === 'considering') return 3;
  return 4;
}

/** 年月（YYYY-MM）に月数を足す。 */
function addMonths(month: string, count: number): string {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 表示する月の一覧。当月（または当月より前の最も早い発売月）から、最も遅い発売月（または当月）まで。 */
function listMonthsToShow(products: readonly ProductResponse[], currentMonth: string): string[] {
  const releaseMonths = products.map((product) => product.releaseMonth).sort();
  const firstMonth = [currentMonth, releaseMonths[0] ?? currentMonth].sort()[0] ?? currentMonth;
  const lastMonth = [currentMonth, releaseMonths.at(-1) ?? currentMonth].sort()[1] ?? currentMonth;
  const months: string[] = [];
  for (let month = firstMonth; month <= lastMonth; month = addMonths(month, 1)) months.push(month);
  return months;
}

/** 商品の見出しの集計を求める。 */
function summarizeProducts(products: readonly ProductResponse[]): GroupSummary {
  const countedProducts = products.filter((product) => product.status !== 'unpurchased');
  const totalYen = countedProducts.reduce(
    (total, product) => (product.price === null ? total : total + product.price + (product.shippingFee ?? 0)),
    0,
  );
  return { count: countedProducts.length, totalYen };
}

/** 年月が属する年のグループのキーと表記を求める。 */
function identifyYear(month: string, yearMode: YearMode): { key: string; label: string } {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  if (yearMode === 'calendar') return { key: String(year), label: `${year}年` };
  const fiscalYear = monthNumber >= 4 ? year : year - 1;
  return { key: `FY${fiscalYear}`, label: `FY${String(fiscalYear).slice(-2)}` };
}

/** 月のグループを作る。商品はその月のものに絞り、並び替える。 */
function buildMonthGroup(month: string, products: readonly ProductResponse[]): MonthGroup {
  const monthProducts = products
    .filter((product) => product.releaseMonth === month)
    .sort((left, right) => rankProduct(left) - rankProduct(right) || left.createdAt.localeCompare(right.createdAt));
  return { month, label: month.replace('-', '/'), products: monthProducts, summary: summarizeProducts(monthProducts) };
}

/** 並べ終えた月のグループを、続いている同じ年ごとにまとめる。 */
function groupMonthsByYear(monthGroups: readonly MonthGroup[], yearMode: YearMode): YearGroup[] {
  const yearGroups: { key: string; label: string; months: MonthGroup[] }[] = [];
  for (const monthGroup of monthGroups) {
    const year = identifyYear(monthGroup.month, yearMode);
    const lastYearGroup = yearGroups.at(-1);
    if (lastYearGroup?.key === year.key) {
      lastYearGroup.months.push(monthGroup);
      continue;
    }
    yearGroups.push({ ...year, months: [monthGroup] });
  }
  return yearGroups.map((yearGroup) => ({
    ...yearGroup,
    summary: summarizeProducts(yearGroup.months.flatMap((monthGroup) => monthGroup.products)),
  }));
}

/**
 * 商品の一覧（リスト）を、年・月のグループに組み立てる。月は古い順で、商品のない月も含める。
 * @param products 商品（順不同）
 * @param options currentMonth は日本時間の当月（YYYY-MM）、yearMode は年のまとめ方
 */
export function buildProductListGroups(
  products: readonly ProductResponse[],
  options: { readonly currentMonth: string; readonly yearMode: YearMode },
): YearGroup[] {
  const monthGroups = listMonthsToShow(products, options.currentMonth).map((month) => buildMonthGroup(month, products));
  return groupMonthsByYear(monthGroups, options.yearMode);
}

/**
 * 商品を、リスト（発売月が当月以降）とアーカイブ（発売月が当月より前）に振り分ける（issue #9）。
 * @param currentMonth 日本時間の当月（YYYY-MM）
 */
export function splitProductsByArchive<Item extends ProductResponse>(
  products: readonly Item[],
  currentMonth: string,
): { active: Item[]; archived: Item[] } {
  return {
    active: products.filter((product) => product.releaseMonth >= currentMonth),
    archived: products.filter((product) => product.releaseMonth < currentMonth),
  };
}

/**
 * アーカイブの商品を、年・月のグループに組み立てる（issue #9）。月は新しい順で、商品のある月だけを含める。
 * 同じ月の中の並び順と集計は、リストと同じ規則にする。
 */
export function buildArchiveGroups(products: readonly ProductResponse[], options: { readonly yearMode: YearMode }): YearGroup[] {
  const months = [...new Set(products.map((product) => product.releaseMonth))].sort().reverse();
  return groupMonthsByYear(
    months.map((month) => buildMonthGroup(month, products)),
    options.yearMode,
  );
}

/** リストの見出しの集計を「3個（合計 44,000円見込）」の形にする。 */
export function formatGroupSummary(summary: GroupSummary): string {
  return `${summary.count}個（合計 ${formatYen(summary.totalYen)}見込）`;
}

/** アーカイブの見出しの集計を「1個（合計 22,800円）」の形にする（実績のため「見込」を付けない）。 */
export function formatArchiveSummary(summary: GroupSummary): string {
  return `${summary.count}個（合計 ${formatYen(summary.totalYen)}）`;
}

/**
 * メーカーの入力の候補を作る（issue #18）。登録済みの商品（アーカイブを含む）のメーカーを、重複なく日本語の順に並べる。
 * 未入力（null）の商品は含めない。
 */
export function collectMakerSuggestions(products: readonly ProductResponse[]): string[] {
  const makers = new Set(products.flatMap((product) => (product.maker === null ? [] : [product.maker])));
  return [...makers].sort((left, right) => left.localeCompare(right, 'ja'));
}

/** カテゴリーの絞り込みの選択（issue #10）。何も選んでいなければ、すべての商品を表示する。 */
export type CategoryFilter = {
  /** 選んだカテゴリーの ID。 */
  readonly categoryIds: ReadonlySet<string>;
  /** 「カテゴリー未設定」を選んだか。 */
  readonly includesUncategorized: boolean;
};

/** 絞り込みの選択肢（「カテゴリー未設定」を除く）。 */
export type CategoryFilterOption = { readonly id: string; readonly label: string };

/** 何も選んでいないか。 */
export function isCategoryFilterEmpty(filter: CategoryFilter): boolean {
  return filter.categoryIds.size === 0 && !filter.includesUncategorized;
}

/**
 * 商品をカテゴリーで絞り込む（issue #10）。何も選んでいなければ、すべての商品を返す。
 * 選んだカテゴリーの商品と、「カテゴリー未設定」を選んだ場合はカテゴリーのない商品を返す。
 */
export function filterProductsByCategory<Item extends ProductResponse>(products: readonly Item[], filter: CategoryFilter): Item[] {
  if (isCategoryFilterEmpty(filter)) return [...products];
  return products.filter((product) =>
    product.categoryId === null ? filter.includesUncategorized : filter.categoryIds.has(product.categoryId),
  );
}

/**
 * 絞り込みの選択肢を作る（issue #10）。定義の並び順のカテゴリーの後に、
 * 定義にないカテゴリーの商品があれば「名前（定義にない）」を重複なく加える。
 */
export function buildCategoryFilterOptions(
  categories: readonly CategoryResponse[],
  products: readonly ProductResponse[],
): CategoryFilterOption[] {
  const options: CategoryFilterOption[] = categories.map((category) => ({ id: category.id, label: category.name }));
  const knownIds = new Set(options.map((option) => option.id));
  for (const product of products) {
    if (product.categoryId === null || knownIds.has(product.categoryId)) continue;
    knownIds.add(product.categoryId);
    options.push({ id: product.categoryId, label: formatUndefinedCategoryLabel(product.categoryName ?? product.categoryId) });
  }
  return options;
}

/** 定義にないカテゴリーの表記（例: 旧カテゴリー（定義にない））。 */
export function formatUndefinedCategoryLabel(categoryName: string): string {
  return `${categoryName}（定義にない）`;
}
