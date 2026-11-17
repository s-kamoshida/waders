/**
 * 一覧の組み立て（年・月のグループ、並び順、見出しの集計）。
 *
 * 所属: クライアント
 * 責務: 商品の一覧を、画面に表示する年・月のグループに組み立てる純粋な関数（要件「リストの構成」）。
 */
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

/**
 * 商品の一覧を、年・月のグループに組み立てる。
 * @param products 商品（順不同）
 * @param options currentMonth は日本時間の当月（YYYY-MM）、yearMode は年のまとめ方
 */
export function buildProductListGroups(
  products: readonly ProductResponse[],
  options: { readonly currentMonth: string; readonly yearMode: YearMode },
): YearGroup[] {
  const monthGroups: MonthGroup[] = listMonthsToShow(products, options.currentMonth).map((month) => {
    const monthProducts = products
      .filter((product) => product.releaseMonth === month)
      .sort((left, right) => rankProduct(left) - rankProduct(right) || left.createdAt.localeCompare(right.createdAt));
    return { month, label: month.replace('-', '/'), products: monthProducts, summary: summarizeProducts(monthProducts) };
  });

  const yearGroups: { key: string; label: string; months: MonthGroup[] }[] = [];
  for (const monthGroup of monthGroups) {
    const year = identifyYear(monthGroup.month, options.yearMode);
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

/** 見出しの集計を「3個（合計 44,000円見込）」の形にする。 */
export function formatGroupSummary(summary: GroupSummary): string {
  return `${summary.count}個（合計 ${formatYen(summary.totalYen)}見込）`;
}
