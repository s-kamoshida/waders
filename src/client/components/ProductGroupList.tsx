/**
 * 年・月のグループの表示（リストとアーカイブで共用）。
 *
 * 所属: クライアント（画面の部品）
 * 責務: 組み立て済みの年・月のグループを、折りたためる見出し（個数と合計金額）と商品のカードで表示する。
 * 見出しの集計の表記（見込みか実績か）と、月の並びの最後に追加のカードを置くか（リストだけ。issue #16・#68）、
 * ドラッグアンドドロップで発売月を移動できるか（リストだけ。issue #13）は呼び出し側が決める。
 * 商品は、スマートフォンの幅（横幅 600px 以下）では 1 行に 1 件のリスト形式、それより広い幅ではカードのグリッドで並べる（issue #15）。
 * カードにはカテゴリーの定義と並べ方を渡す（リスト形式では開催日時の代わりに開催期間を示す。PR #30 のレビュー）。
 * 発売月が未定の商品のまとまり（issue #62）を渡すと、年・月のグループの下に、年と同じ階層の見出しで表示する。
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import type { CategoryResponse } from '../../shared/categoryContract.ts';
import type { ProductResponse } from '../../shared/productContract.ts';
import type { GroupSummary, MonthGroup, UndeterminedGroup, YearGroup } from '../productList.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';
import { ProductCard } from './ProductCard.tsx';
import { convertReleaseMonthToDropTargetKey, UNDETERMINED_DROP_TARGET_KEY, useProductDragAndDrop } from './useProductDragAndDrop.ts';

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

/** ドラッグ中の案内の文言。落とす先のキー（年月か未定）から作る。 */
function formatDragIndicator(dropTargetKey: string | null): string {
  if (dropTargetKey === null) return '移動先の月まで動かしてください';
  if (dropTargetKey === UNDETERMINED_DROP_TARGET_KEY) return `${SCREEN_MESSAGES.undeterminedReleaseMonthGroup} に移動`;
  return `${dropTargetKey.replace('-', '/')} に移動`;
}

/** ProductGroupList の引数。 */
export type ProductGroupListProps = {
  readonly yearGroups: readonly YearGroup[];
  /** 発売月が未定の商品のまとまり（issue #62）。渡すと、年・月のグループの下に表示する。省くと表示しない。 */
  readonly undeterminedGroup?: UndeterminedGroup;
  /** 見出しの集計の表記。 */
  readonly formatSummary: (summary: GroupSummary) => string;
  /** 日本時間の今日の日付（受注期限の警告の判定に使う）。 */
  readonly today: string;
  /** 商品を押したときに呼ぶ。 */
  readonly onSelect: (product: ProductResponse) => void;
  /**
   * 渡すと、各月（未定のまとまりを含む）の商品の並びの最後に「＋」だけの追加のカードを置き（issue #68。それまでは月の見出しの右端）、
   * 押したときにその月（YYYY-MM。未定のまとまりは null）を渡して呼ぶ。0 件の月は「商品はありません」の代わりにこのカードだけを表示する。
   */
  readonly onAddToMonth?: (month: string | null) => void;
  /**
   * 渡すと、商品をドラッグアンドドロップで別の月に移動できる。別の月に落としたときに、新しい発売月
   * （未定のまとまりは null。issue #62）を渡して呼ぶ（issue #13）。
   */
  readonly onMoveProduct?: (product: ProductResponse, month: string | null) => void;
  /** カテゴリーの定義（カードの「送料無料」と「その他費用」の名前に使う。issue #27）。読めない・読み込み中は null。 */
  readonly categories?: readonly CategoryResponse[] | null;
};

/** 年・月のグループを表示する。 */
export function ProductGroupList({
  yearGroups,
  undeterminedGroup,
  formatSummary,
  today,
  onSelect,
  onAddToMonth,
  onMoveProduct,
  categories = null,
}: ProductGroupListProps) {
  const [collapsedYearKeys, setCollapsedYearKeys] = useState<ReadonlySet<string>>(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<ReadonlySet<string>>(new Set());
  const moveProduct = useCallback(
    (product: ProductResponse, month: string | null) => onMoveProduct?.(product, month),
    [onMoveProduct],
  );
  const dragAndDrop = useProductDragAndDrop(moveProduct);
  const canMove = onMoveProduct !== undefined;
  const isPhoneWidth = useIsPhoneWidth();
  const productContainerClassName = isPhoneWidth ? 'product-list' : 'product-grid';

  /** 月のまとまり（未定のまとまりを含む）の section に付ける属性（名前・落とす先の強調と操作）。 */
  const getMonthSectionProps = (monthGroup: MonthGroup | UndeterminedGroup, className: string) => {
    const dropTargetKey = convertReleaseMonthToDropTargetKey(monthGroup.month);
    return {
      className: dragAndDrop.dropTargetMonth === dropTargetKey ? `${className} month-group--drop-target` : className,
      'aria-label': monthGroup.label,
      ...(canMove ? dragAndDrop.getMonthDropTargetProps(dropTargetKey) : {}),
    };
  };

  /** 月のまとまりの、折りたたみの見出しのボタン。 */
  const renderToggle = (monthGroup: MonthGroup | UndeterminedGroup, isExpanded: boolean) => (
    <button
      type="button"
      className="group-toggle"
      aria-expanded={isExpanded}
      onClick={() => setCollapsedMonths((current) => toggleSetValue(current, convertReleaseMonthToDropTargetKey(monthGroup.month)))}
    >
      <span className="group-caret" aria-hidden="true" />
      <span className="group-label">{monthGroup.label}</span>{' '}
      <span className="group-summary">{formatSummary(monthGroup.summary)}</span>
    </button>
  );

  /** 月のまとまりの並びの最後に置く、「＋」だけの追加のカード（onAddToMonth を渡した場合だけ。issue #68）。 */
  const renderAddCard = (monthGroup: MonthGroup | UndeterminedGroup) =>
    onAddToMonth !== undefined && (
      <button
        type="button"
        className="product-add-card"
        aria-label={`${monthGroup.label}に商品を追加`}
        onClick={() => onAddToMonth(monthGroup.month)}
      >
        ＋
      </button>
    );

  /** 月のまとまりの商品の並びと、最後の追加のカード。追加のカードを置かず（アーカイブ）商品もなければ「商品はありません」。 */
  const renderProducts = (monthGroup: MonthGroup | UndeterminedGroup) => {
    const { products } = monthGroup;
    if (products.length === 0 && onAddToMonth === undefined) return <p className="empty-month">{SCREEN_MESSAGES.emptyMonth}</p>;
    return (
      <div className={productContainerClassName}>
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            today={today}
            onSelect={onSelect}
            dragHandlers={canMove ? dragAndDrop.getCardHandlers(product) : undefined}
            isGrabbed={dragAndDrop.grabbedProductId === product.id}
            categories={categories}
            layout={isPhoneWidth ? 'list' : 'grid'}
          />
        ))}
        {renderAddCard(monthGroup)}
      </div>
    );
  };

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
            const isMonthExpanded = !collapsedMonths.has(convertReleaseMonthToDropTargetKey(monthGroup.month));
            return (
              <section key={monthGroup.month} {...getMonthSectionProps(monthGroup, 'month-group')}>
                <h3 className="month-heading">{renderToggle(monthGroup, isMonthExpanded)}</h3>
                {isMonthExpanded && renderProducts(monthGroup)}
              </section>
            );
          })}
      </section>
    );
  });

  const isUndeterminedExpanded = !collapsedMonths.has(UNDETERMINED_DROP_TARGET_KEY);

  return (
    <>
      {groups}
      {undeterminedGroup !== undefined && (
        <section {...getMonthSectionProps(undeterminedGroup, 'year-group undetermined-group')}>
          <h2 className="year-heading undetermined-heading">{renderToggle(undeterminedGroup, isUndeterminedExpanded)}</h2>
          {isUndeterminedExpanded && renderProducts(undeterminedGroup)}
        </section>
      )}
      {dragAndDrop.grabbedProductId !== null && (
        <div className="drag-indicator" aria-hidden="true">
          {formatDragIndicator(dragAndDrop.dropTargetMonth)}
        </div>
      )}
    </>
  );
}
