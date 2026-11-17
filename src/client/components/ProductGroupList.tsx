/**
 * 年・月のグループの表示（リストとアーカイブで共用）。
 *
 * 所属: クライアント（画面の部品）
 * 責務: 組み立て済みの年・月のグループを、折りたためる見出し（個数と合計金額）と商品のカードで表示する。
 * 見出しの集計の表記（見込みか実績か）は呼び出し側が渡す。
 */
import { useState } from 'react';
import type { ProductResponse } from '../../shared/productContract.ts';
import type { GroupSummary, YearGroup } from '../productList.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';
import { ProductCard } from './ProductCard.tsx';

/** 集合に値があれば取り除き、なければ加えた新しい集合を返す。 */
function toggleSetValue(values: ReadonlySet<string>, value: string): Set<string> {
  const nextValues = new Set(values);
  if (nextValues.has(value)) nextValues.delete(value);
  else nextValues.add(value);
  return nextValues;
}

/** ProductGroupList の引数。 */
export type ProductGroupListProps = {
  readonly yearGroups: readonly YearGroup[];
  /** 見出しの集計の表記。 */
  readonly formatSummary: (summary: GroupSummary) => string;
  /** 日本時間の今日の日付（受注期限の警告の判定に使う）。 */
  readonly today: string;
  /** 商品を押したときに呼ぶ。 */
  readonly onSelect: (product: ProductResponse) => void;
};

/** 年・月のグループを表示する。 */
export function ProductGroupList({ yearGroups, formatSummary, today, onSelect }: ProductGroupListProps) {
  const [collapsedYearKeys, setCollapsedYearKeys] = useState<ReadonlySet<string>>(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<ReadonlySet<string>>(new Set());

  return yearGroups.map((yearGroup) => {
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
            <span className="group-summary">{formatSummary(yearGroup.summary)}</span>
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
                    <span className="group-summary">{formatSummary(monthGroup.summary)}</span>
                  </button>
                </h3>
                {isMonthExpanded && monthGroup.products.length === 0 && <p className="empty-month">{SCREEN_MESSAGES.emptyMonth}</p>}
                {isMonthExpanded && monthGroup.products.length > 0 && (
                  <div className="product-grid">
                    {monthGroup.products.map((product) => (
                      <ProductCard key={product.id} product={product} today={today} onSelect={onSelect} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
      </section>
    );
  });
}
