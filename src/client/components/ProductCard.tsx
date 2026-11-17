/**
 * 商品のカード。
 *
 * 所属: クライアント（画面の部品）
 * 責務: 1 件の商品を、画像（共通のアイコン）・ステータス・商品名・金額・送料・受注期限・購入先のリンクとして表示する。
 * カードを押すと onSelect で選択を知らせる。購入先のリンクは別のタブで開き、選択はしない。
 */
import type { ProductResponse } from '../../shared/productContract.ts';
import {
  extractShopDomain,
  formatPriceLabel,
  formatShippingLabel,
  formatShortDate,
  getStatusLabel,
  isOrderDeadlineApproaching,
} from '../productDisplay.ts';

/** ProductCard の引数。 */
export type ProductCardProps = {
  readonly product: ProductResponse;
  /** 日本時間の今日の日付（YYYY-MM-DD）。受注期限の警告に使う。 */
  readonly today: string;
  readonly onSelect: (product: ProductResponse) => void;
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

/** 商品のカードを描画する。 */
export function ProductCard({ product, today, onSelect }: ProductCardProps) {
  const isWarning = isOrderDeadlineApproaching(product, today);
  const shopDomain = extractShopDomain(product.url);
  const showsOrderDeadline = product.status === 'considering' && product.orderDeadline !== null;

  return (
    <article className={`product-card ${selectStatusClassName(product)}`}>
      <button type="button" className="product-card-main" onClick={() => onSelect(product)}>
        <span className="product-card-thumbnail">
          <ProductPlaceholderIcon />
          <span className="product-card-status">{getStatusLabel(product.status, product.cancelable)}</span>
        </span>
        <span className="product-card-body">
          <span className="product-card-name">{isWarning ? `⚠️ ${product.name}` : product.name}</span>
          <span className="product-card-price">
            <span>{formatPriceLabel(product.price)}</span>
            {product.price !== null && <span className="product-card-shipping">{formatShippingLabel(product.shippingFee)}</span>}
          </span>
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
