/**
 * 商品の表示の補助（金額・送料・購入先・ステータスの表記、受注期限の警告、日本時間の日付）。
 *
 * 所属: クライアント
 * 責務: 商品の値を画面の表記に変える純粋な関数をまとめる（要件「主な機能」「商品の表示」）。
 */
import type { ProductStatus } from '../shared/productContract.ts';

const MILLISECONDS_PER_DAY = 86_400_000;
/** 日本時間と UTC の差（日本は夏時間がないため一定）。 */
const JAPAN_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;
/** 受注期限の警告（⚠️）を出す日数。受注期限まで 0〜7 日（当日と 7 日後を含む）。 */
const ORDER_DEADLINE_WARNING_DAYS = 7;

const yenNumberFormat = new Intl.NumberFormat('ja-JP');

/** 金額を「19,800円」の形にする。 */
export function formatYen(amount: number): string {
  return `${yenNumberFormat.format(amount)}円`;
}

/** 金額の表記。未入力は「金額未入力」。 */
export function formatPriceLabel(price: number | null): string {
  return price === null ? '金額未入力' : formatYen(price);
}

/** 送料の表記。未入力と 0 円は「送料無料」、それ以外は「送料 800円」。 */
export function formatShippingLabel(shippingFee: number | null): string {
  if (shippingFee === null || shippingFee === 0) return '送料無料';
  return `送料 ${formatYen(shippingFee)}`;
}

/** 購入先の名前として、URL のドメインを返す。URL が未入力・不正なら null。 */
export function extractShopDomain(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const STATUS_LABELS: Readonly<Record<ProductStatus, string>> = {
  considering: '検討中',
  reserved: '予約済',
  purchased: '購入済',
  unpurchased: '未購入',
};

/** ステータスの表記。予約済でキャンセル可の場合は「予約済（キャンセル可）」。 */
export function getStatusLabel(status: ProductStatus, cancelable: boolean): string {
  if (status === 'reserved' && cancelable) return '予約済（キャンセル可）';
  return STATUS_LABELS[status];
}

/** 日付（YYYY-MM-DD）を、暦の日数を数えるための通し番号にする。 */
function convertDateToDayNumber(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / MILLISECONDS_PER_DAY;
}

/**
 * 受注期限の警告（⚠️）を出すか。検討中で、受注期限まで 0〜7 日の場合に出す。
 * @param today 日本時間の今日の日付（YYYY-MM-DD）
 */
export function isOrderDeadlineApproaching(
  product: { readonly status: ProductStatus; readonly orderDeadline: string | null },
  today: string,
): boolean {
  if (product.status !== 'considering' || product.orderDeadline === null) return false;
  const daysUntilDeadline = convertDateToDayNumber(product.orderDeadline) - convertDateToDayNumber(today);
  return daysUntilDeadline >= 0 && daysUntilDeadline <= ORDER_DEADLINE_WARNING_DAYS;
}

/** 受注期限を「11/20」の形にする。 */
export function formatShortDate(date: string): string {
  const [, month = '', day = ''] = date.split('-');
  return `${Number(month)}/${day}`;
}

/** 日本時間の日付（YYYY-MM-DD）を返す。 */
export function formatDateInJapan(now: Date): string {
  return new Date(now.getTime() + JAPAN_OFFSET_MILLISECONDS).toISOString().slice(0, 10);
}

/** 日本時間の年月（YYYY-MM）を返す。 */
export function formatMonthInJapan(now: Date): string {
  return formatDateInJapan(now).slice(0, 7);
}
