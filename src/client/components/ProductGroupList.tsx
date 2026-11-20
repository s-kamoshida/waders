/**
 * 年・月のグループの表示（リストとアーカイブで共用）。
 *
 * 所属: クライアント（画面の部品）
 * 責務: 組み立て済みの年・月のグループを、折りたためる見出し（個数と合計金額）と商品のカードで表示する。
 * 見出しの集計の表記（見込みか実績か）と、月の見出しの追加ボタンを置くか（リストだけ。issue #16）、
 * ドラッグアンドドロップで発売月を移動できるか（リストだけ。issue #13）は呼び出し側が決める。
 * 商品は、スマートフォンの幅（横幅 600px 以下）では 1 行に 1 件のリスト形式、それより広い幅ではカードのグリッドで並べる（issue #15）。
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import type { ProductResponse } from '../../shared/productContract.ts';
import type { GroupSummary, YearGroup } from '../productList.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';
import { ProductCard } from './ProductCard.tsx';
import { useProductDragAndDrop } from './useProductDragAndDrop.ts';

/** 集合に値があれば取り除き、なければ加えた新しい集合を返す。 */
function toggleSetValue(values: ReadonlySet<string>, value: string): Set<string> {
  const nextValues = new Set(values);
  if (nextValues.has(value)) nextValues.delete(value);
  else nextValues.add(value);
  return nextValues;
}

/** スマートフォンの幅（リスト形式で表示する幅）を表すメディアクエリ。画面設計書の「横幅 600px 以下」と同じ境目（issue #15）。 */
const PHONE_WIDTH_QUERY = '(max-width: 600px)';

/** 画面の幅の変化（端末の向きの変更など）を購読する。matchMedia がない環境では何もしない。 */
function subscribePhoneWidthChange(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mediaQueryList = window.matchMedia(PHONE_WIDTH_QUERY);
  mediaQueryList.addEventListener('change', onChange);
  return () => mediaQueryList.removeEventListener('change', onChange);
}

/** 今の画面がスマートフォンの幅か。matchMedia がない環境では PC の幅として扱う。 */
function readIsPhoneWidth(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(PHONE_WIDTH_QUERY).matches;
}

/** スマートフォンの幅かどうかを返し、画面の幅が変わったら描画し直す（issue #15）。 */
function useIsPhoneWidth(): boolean {
  return useSyncExternalStore(subscribePhoneWidthChange, readIsPhoneWidth, () => false);
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
  /** 渡すと、月の見出しの右端に追加ボタンを置き、押したときにその月（YYYY-MM）を渡して呼ぶ。 */
  readonly onAddToMonth?: (month: string) => void;
  /** 渡すと、商品をドラッグアンドドロップで別の月に移動できる。別の月に落としたときに呼ぶ（issue #13）。 */
  readonly onMoveProduct?: (product: ProductResponse, month: string) => void;
};

/** 年・月のグループを表示する。 */
export function ProductGroupList({ yearGroups, formatSummary, today, onSelect, onAddToMonth, onMoveProduct }: ProductGroupListProps) {
  const [collapsedYearKeys, setCollapsedYearKeys] = useState<ReadonlySet<string>>(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<ReadonlySet<string>>(new Set());
  const moveProduct = useCallback(
    (product: ProductResponse, month: string) => onMoveProduct?.(product, month),
    [onMoveProduct],
  );
  const dragAndDrop = useProductDragAndDrop(moveProduct);
  const canMove = onMoveProduct !== undefined;
  const productContainerClassName = useIsPhoneWidth() ? 'product-list' : 'product-grid';

  const groups = yearGroups.map((yearGroup) => {
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
              <section
                key={monthGroup.month}
                className={dragAndDrop.dropTargetMonth === monthGroup.month ? 'month-group month-group--drop-target' : 'month-group'}
                aria-label={monthGroup.label}
                {...(canMove ? dragAndDrop.getMonthDropTargetProps(monthGroup.month) : {})}
              >
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
                  {onAddToMonth !== undefined && (
                    <button
                      type="button"
                      className="month-add-button"
                      aria-label={`${monthGroup.label}に商品を追加`}
                      onClick={() => onAddToMonth(monthGroup.month)}
                    >
                      ＋
                    </button>
                  )}
                </h3>
                {isMonthExpanded && monthGroup.products.length === 0 && <p className="empty-month">{SCREEN_MESSAGES.emptyMonth}</p>}
                {isMonthExpanded && monthGroup.products.length > 0 && (
                  <div className={productContainerClassName}>
                    {monthGroup.products.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        today={today}
                        onSelect={onSelect}
                        dragHandlers={canMove ? dragAndDrop.getCardHandlers(product) : undefined}
                        isGrabbed={dragAndDrop.grabbedProductId === product.id}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
      </section>
    );
  });

  return (
    <>
      {groups}
      {dragAndDrop.grabbedProductId !== null && (
        <div className="drag-indicator" aria-hidden="true">
          {dragAndDrop.dropTargetMonth === null ? '移動先の月まで動かしてください' : `${dragAndDrop.dropTargetMonth.replace('-', '/')} に移動`}
        </div>
      )}
    </>
  );
}
