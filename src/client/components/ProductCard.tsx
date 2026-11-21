/**
 * 商品のカード。
 *
 * 所属: クライアント（画面の部品）
 * 責務: 1 件の商品を、画像（共通のアイコン）・ステータス・メーカー・商品名・場所・金額・送料・費用・備考の印・開催日時・受注期限・
 * 購入先のリンクとして表示する。
 *  - 費用（手数料・交通費（見込）・その他費用）は値があるものだけを示し、その他費用はカテゴリーの名前で示す（issue #26・#27）
 *  - 「送料無料」は、送料が有効なカテゴリーの商品（未設定・定義にないカテゴリーを含む）にだけ示す（issue #27）
 *  - 開催日時と終了日時は両方あるときだけ、並べる形式では日時、リスト形式では開催期間を示す（PR #30 のレビュー）
 * カードを押すと onSelect で選択を知らせる。購入先のリンクは別のタブで開き、選択はしない。
 */
import type { HTMLAttributes } from 'react';
import type { CategoryResponse } from '../../shared/categoryContract.ts';
import type { ProductResponse } from '../../shared/productContract.ts';
import {
  determineVisibleCategoryFields,
  extractShopDomain,
  formatEventDuration,
  formatEventPeriod,
  formatYen,
  formatPriceLabel,
  formatShippingLabel,
  formatShortDate,
  getStatusLabel,
  isOrderDeadlineApproaching,
  resolveOtherExpenseLabel,
} from '../productDisplay.ts';

/** ProductCard の引数。 */
export type ProductCardProps = {
  readonly product: ProductResponse;
  /** 日本時間の今日の日付（YYYY-MM-DD）。受注期限の警告に使う。 */
  readonly today: string;
  readonly onSelect: (product: ProductResponse) => void;
  /** ドラッグアンドドロップの操作（リストだけ。issue #13）。カードの要素に付ける。 */
  readonly dragHandlers?: Pick<HTMLAttributes<HTMLElement>, 'draggable' | 'onDragStart' | 'onDragEnd' | 'onPointerDown' | 'onClickCapture' | 'onContextMenu'>;
  /** タッチ操作で掴んでいる間は true（浮いた見た目にする）。 */
  readonly isGrabbed?: boolean;
  /**
   * カテゴリーの定義（「送料無料」を示すかと、「その他費用」の名前を決める。issue #27）。
   * 定義を読めない場合や省略した場合は null（すべての項目を有効とみなす）。
   */
  readonly categories?: readonly CategoryResponse[] | null;
  /** 並べ方。grid はカードを並べる形式（既定）、list はスマートフォンの幅のリスト形式（開催期間を示す。PR #30 のレビュー）。 */
  readonly layout?: 'grid' | 'list';
};

/** ステータスの見た目を切り替えるためのクラス名。 */
function selectStatusClassName(product: ProductResponse): string {
  if (product.status === 'reserved' && product.cancelable) return 'product-card--cancelable';
  return `product-card--${product.status}`;
}

/** 画像がない商品に表示する共通のアイコン。 */
function ProductPlaceholderIcon() {
  return (
    <svg className="product-card-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M3 11h18M12 7v13M12 7c-1.5-3-5-3.5-5-1.5S10 7 12 7Zm0 0c1.5-3 5-3.5 5-1.5S14 7 12 7Z" />
    </svg>
  );
}

/** 値がある費用を「手数料 330円」の形で並べる（その他費用はカテゴリーの名前で示す）。 */
function listAdditionalCostLabels(product: ProductResponse, otherExpenseLabel: string): string[] {
  const costs: [string, number | null][] = [
    ['手数料', product.handlingFee],
    ['交通費（見込）', product.travelExpense],
    [otherExpenseLabel, product.otherExpense],
  ];
  return costs.flatMap(([label, amount]) => (amount === null ? [] : [`${label} ${formatYen(amount)}`]));
}

/** 開催の表示（両方あるときだけ）。並べる形式は日時、リスト形式は開催期間。 */
function formatEventLabel(product: ProductResponse, layout: 'grid' | 'list'): string | null {
  if (product.eventStartsAt === null || product.eventEndsAt === null) return null;
  const period =
    layout === 'list' ? formatEventDuration(product.eventStartsAt, product.eventEndsAt) : formatEventPeriod(product.eventStartsAt, product.eventEndsAt);
  return `開催 ${period}`;
}

/** 商品のカードを描画する。 */
export function ProductCard({ product, today, onSelect, dragHandlers, isGrabbed = false, categories = null, layout = 'grid' }: ProductCardProps) {
  const isWarning = isOrderDeadlineApproaching(product, today);
  const shopDomain = extractShopDomain(product.url);
  const showsOrderDeadline = product.status === 'considering' && product.orderDeadline !== null;
  const showsShipping = determineVisibleCategoryFields(categories, product.categoryId, product).has('shippingFee');
  const additionalCostLabels = listAdditionalCostLabels(product, resolveOtherExpenseLabel(categories, product.categoryId));
  const eventLabel = formatEventLabel(product, layout);

  return (
    <article className={`product-card ${selectStatusClassName(product)}${isGrabbed ? ' product-card--grabbed' : ''}`} {...dragHandlers}>
      <button type="button" className="product-card-main" onClick={() => onSelect(product)}>
        <span className="product-card-thumbnail">
          <ProductPlaceholderIcon />
          <span className="product-card-status">{getStatusLabel(product.status, product.cancelable)}</span>
        </span>
        <span className="product-card-body">
          {product.maker !== null && <span className="product-card-maker">{product.maker}</span>}
          <span className="product-card-name">{isWarning ? `⚠️ ${product.name}` : product.name}</span>
          {product.location !== null && <span className="product-card-location">{product.location}</span>}
          <span className="product-card-price">
            <span>{formatPriceLabel(product.price)}</span>
            {product.price !== null && showsShipping && <span className="product-card-shipping">{formatShippingLabel(product.shippingFee)}</span>}
            {product.note !== null && (
              <span className="product-card-note" role="img" aria-label="備考あり" title="備考あり">
                📝
              </span>
            )}
          </span>
          {additionalCostLabels.length > 0 && (
            <span className="product-card-costs">
              {additionalCostLabels.map((label) => (
                <span key={label} className="product-card-cost">
                  {label}
                </span>
              ))}
            </span>
          )}
          {eventLabel !== null && <span className="product-card-event">{eventLabel}</span>}
          {showsOrderDeadline && (
            <span className={isWarning ? 'product-card-deadline product-card-deadline--warning' : 'product-card-deadline'}>
              {`受注期限 ${formatShortDate(product.orderDeadline ?? '')}`}
            </span>
          )}
        </span>
      </button>
      {shopDomain !== null && product.url !== null && (
        <a className="product-card-shop" href={product.url} target="_blank" rel="noopener noreferrer">
          {shopDomain}
        </a>
      )}
    </article>
  );
}
