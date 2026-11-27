/**
 * 商品の表示の補助（金額（値引き後）・送料・購入先・ステータスの表記、受注期限の警告、日本時間の日付、開催日時と開催期間、
 * カテゴリーごとに表示する入力項目と「その他費用」の名前）。
 *
 * 所属: クライアント
 * 責務: 商品の値を画面の表記に変える純粋な関数をまとめる（要件「主な機能」「商品の表示」「カテゴリーごとの入力項目」）。
 */
import {
  CATEGORY_CONTROLLED_FIELDS,
  DEFAULT_ENABLED_FIELDS,
  DEFAULT_OTHER_EXPENSE_LABEL,
  type CategoryControlledField,
  type CategoryResponse,
} from '../shared/categoryContract.ts';
import type { ProductResponse, ProductStatus } from '../shared/productContract.ts';

export { formatDateInJapan, formatMonthInJapan } from '../shared/japanCalendar.ts';

const MILLISECONDS_PER_DAY = 86_400_000;
const MILLISECONDS_PER_MINUTE = 60_000;
/** 日本時間と UTC の差（日本は夏時間がないため一定）。 */
const JAPAN_OFFSET_MILLISECONDS = 9 * 60 * MILLISECONDS_PER_MINUTE;
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

/**
 * カード・リストに表示する金額（値引き後の金額）を求める（issue #50）。
 * 値引きが金額を超える場合（送料などまでポイントで払った場合）は 0 円にする。
 * @returns 金額が未入力なら null、値引きがなければ金額のまま
 */
export function calculateDiscountedPrice(price: number | null, discount: number | null): number | null {
  if (price === null) return null;
  return Math.max(0, price - (discount ?? 0));
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

/** 日本時間の日時の各部分。 */
type JapanDateTimeParts = { year: number; month: number; day: number; hour: number; minute: number };

/** UTC の日時（ISO 8601）を、日本時間の年・月・日・時・分にする。 */
function convertToJapanDateTimeParts(utcDateTime: string): JapanDateTimeParts {
  const japanTime = new Date(Date.parse(utcDateTime) + JAPAN_OFFSET_MILLISECONDS);
  return {
    year: japanTime.getUTCFullYear(),
    month: japanTime.getUTCMonth() + 1,
    day: japanTime.getUTCDate(),
    hour: japanTime.getUTCHours(),
    minute: japanTime.getUTCMinutes(),
  };
}

/** 時刻を「18:00」「0:30」の形にする（時は 0 を付けず、分は 2 桁）。 */
function formatClockTime(parts: JapanDateTimeParts): string {
  return `${parts.hour}:${String(parts.minute).padStart(2, '0')}`;
}

/**
 * 開催日時と終了日時を、日本時間で「11/20 18:00〜21:00」の形にする（カードを並べる形式。PR #30 のレビュー）。
 * 終了が開催と同じ日なら終了の日付を省き、別の日なら「11/20 18:00〜11/21 0:30」、年が変わるなら「2026/12/31 22:00〜2027/1/1 2:00」とする。
 * @param eventStartsAt 開催日時（UTC の ISO 8601）
 * @param eventEndsAt 終了日時（UTC の ISO 8601）
 */
export function formatEventPeriod(eventStartsAt: string, eventEndsAt: string): string {
  const start = convertToJapanDateTimeParts(eventStartsAt);
  const end = convertToJapanDateTimeParts(eventEndsAt);
  const isSameYear = start.year === end.year;
  const formatDate = (parts: JapanDateTimeParts) => (isSameYear ? `${parts.month}/${parts.day}` : `${parts.year}/${parts.month}/${parts.day}`);
  const isSameDay = isSameYear && start.month === end.month && start.day === end.day;
  const endLabel = isSameDay ? formatClockTime(end) : `${formatDate(end)} ${formatClockTime(end)}`;
  return `${formatDate(start)} ${formatClockTime(start)}〜${endLabel}`;
}

/** 0.5 刻みの数（半単位の個数で受け取る）を、小数がある場合だけ小数第一位まで示す（例: 3 → 1.5、4 → 2）。 */
function formatHalfUnits(halfUnitCount: number): string {
  return halfUnitCount % 2 === 0 ? String(halfUnitCount / 2) : (halfUnitCount / 2).toFixed(1);
}

/** 分を、単位の半分（halfUnitMinutes 分）ごとの個数に四捨五入する（ちょうど半分は切り上げ）。 */
function roundToHalfUnits(minutes: number, halfUnitMinutes: number): number {
  return Math.floor((minutes + halfUnitMinutes / 2) / halfUnitMinutes);
}

/**
 * 開催日時から終了日時までの開催期間を「約3時間」「約1.5日」の形にする（スマートフォンの幅のリスト形式。PR #30 のレビュー）。
 * 時間の単位で 0.5 刻みに四捨五入し（最小は 0.5 時間）、その結果が 24 時間以上なら日の単位で 0.5 刻みに四捨五入する。
 * 浮動小数の誤差を避けるため、分の整数で計算する。
 * @param eventStartsAt 開催日時（UTC の ISO 8601）
 * @param eventEndsAt 終了日時（UTC の ISO 8601。開催日時以降）
 */
export function formatEventDuration(eventStartsAt: string, eventEndsAt: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(eventEndsAt) - Date.parse(eventStartsAt)) / MILLISECONDS_PER_MINUTE));
  const halfHourCount = Math.max(1, roundToHalfUnits(minutes, 30));
  if (halfHourCount < 48) return `約${formatHalfUnits(halfHourCount)}時間`;
  return `約${formatHalfUnits(roundToHalfUnits(minutes, 12 * 60))}日`;
}

/** 日本時間の日時の入力欄の値（例: 2026-11-20T18:00）を、UTC の ISO 8601 にする。空なら null。 */
export function convertJapanDateTimeInputToUtc(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (match === null) return value.trim() === '' ? null : value.trim();
  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - JAPAN_OFFSET_MILLISECONDS).toISOString();
}

/** UTC の ISO 8601 を、日本時間の日時の入力欄の値（例: 2026-11-20T18:00）にする。未入力なら空。 */
export function formatUtcAsJapanDateTimeInput(utcDateTime: string | null): string {
  if (utcDateTime === null) return '';
  return new Date(Date.parse(utcDateTime) + JAPAN_OFFSET_MILLISECONDS).toISOString().slice(0, 16);
}

/** 商品に値が保存されている、出し入れできる入力項目。キャンセル可否は「可」の場合、開催日時と終了日時はどちらかに値がある場合。 */
export function listStoredCategoryFields(product: ProductResponse): CategoryControlledField[] {
  const hasValue: Readonly<Record<CategoryControlledField, boolean>> = {
    shippingFee: product.shippingFee !== null,
    maker: product.maker !== null,
    orderDeadline: product.orderDeadline !== null,
    cancelable: product.cancelable,
    location: product.location !== null,
    eventPeriod: product.eventStartsAt !== null || product.eventEndsAt !== null,
    handlingFee: product.handlingFee !== null,
    travelExpense: product.travelExpense !== null,
    otherExpense: product.otherExpense !== null,
  };
  return CATEGORY_CONTROLLED_FIELDS.filter((field) => hasValue[field]);
}

/**
 * カテゴリーで有効な入力項目を返す（issue #27）。
 * 定義を読めない場合（categories が null）はすべての項目、定義にあるカテゴリーはその設定、
 * カテゴリー未設定・定義にないカテゴリーは既定（既存の項目。PR #30 の確認への回答）とする。
 */
export function listEnabledCategoryFields(
  categories: readonly CategoryResponse[] | null,
  categoryId: string | null,
): readonly CategoryControlledField[] {
  if (categories === null) return CATEGORY_CONTROLLED_FIELDS;
  const category = categories.find((candidate) => candidate.id === categoryId);
  return category === undefined ? DEFAULT_ENABLED_FIELDS : category.fields;
}

/**
 * 表示する入力項目を返す（issue #27）。カテゴリーで有効な項目と、値が保存されている項目。
 * @param storedProduct 値が保存されているかを見る商品（追加の場合は省略）
 */
export function determineVisibleCategoryFields(
  categories: readonly CategoryResponse[] | null,
  categoryId: string | null,
  storedProduct?: ProductResponse,
): ReadonlySet<CategoryControlledField> {
  const storedFields = storedProduct === undefined ? [] : listStoredCategoryFields(storedProduct);
  return new Set([...listEnabledCategoryFields(categories, categoryId), ...storedFields]);
}

/** 「その他費用」の名前を返す。定義にあるカテゴリーはその名前、それ以外（未設定・定義にない・定義を読めない）は「その他費用」（issue #27）。 */
export function resolveOtherExpenseLabel(categories: readonly CategoryResponse[] | null, categoryId: string | null): string {
  return categories?.find((candidate) => candidate.id === categoryId)?.otherExpenseLabel ?? DEFAULT_OTHER_EXPENSE_LABEL;
}

/** 曜日の表記（日曜から）。 */
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 発売月（YYYY-MM）を「2026/12」の形にする（詳細画面。issue #52）。 */
export function formatReleaseMonthLabel(releaseMonth: string): string {
  return releaseMonth.replace('-', '/');
}

/** 日付（YYYY-MM-DD）を「2026/11/30」の形にする（詳細画面の受注期限。issue #52）。 */
export function formatFullDate(date: string): string {
  return date.replaceAll('-', '/');
}

/** UTC の日時（ISO 8601）を、日本時間で「2027/01/24（日）17:00」の形にする（詳細画面の開催日時・終了日時。issue #52）。 */
export function formatJapanDateTimeWithWeekday(utcDateTime: string): string {
  const parts = convertToJapanDateTimeParts(utcDateTime);
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()] ?? '';
  const date = `${parts.year}/${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}`;
  return `${date}（${weekday}）${formatClockTime(parts)}`;
}

/** 詳細画面の金額の表示。 */
export type ProductAmountDescription = {
  /** 最終的な金額（「2,660円」）。 */
  readonly total: string;
  /** 内訳（「（2,500円 ＋ 送料 660円 − 値引き 500円）」）。費用も値引きもなければ null。 */
  readonly breakdown: string | null;
};

/**
 * 詳細画面の金額を求める（issue #52）。最終的な金額は、金額＋送料・手数料・交通費（見込）・その他費用 − 値引き（0円未満にはしない）。
 * 値がない・0円の費用と値引きは内訳に出さない。
 * @param otherExpenseLabel その他費用の名前（カテゴリーで決めた名前）
 * @returns 金額が未入力なら null
 */
export function describeProductAmount(product: ProductResponse, otherExpenseLabel: string): ProductAmountDescription | null {
  if (product.price === null) return null;
  const costs: [string, number | null][] = [
    ['送料', product.shippingFee],
    ['手数料', product.handlingFee],
    ['交通費（見込）', product.travelExpense],
    [otherExpenseLabel, product.otherExpense],
  ];
  const presentCosts = costs.flatMap(([label, amount]) => (amount === null || amount === 0 ? [] : [{ label, amount }]));
  const discount = product.discount ?? 0;
  const costTotal = presentCosts.reduce((total, cost) => total + cost.amount, product.price);
  const total = formatYen(Math.max(0, costTotal - discount));
  if (presentCosts.length === 0 && discount === 0) return { total, breakdown: null };
  const costParts = presentCosts.map((cost) => ` ＋ ${cost.label} ${formatYen(cost.amount)}`).join('');
  const discountPart = discount === 0 ? '' : ` − 値引き ${formatYen(discount)}`;
  return { total, breakdown: `（${formatYen(product.price)}${costParts}${discountPart}）` };
}
