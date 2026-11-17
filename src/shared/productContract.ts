/**
 * 商品の入力の検証ルール（クライアントとサーバーで共用）。
 *
 * 所属: 共有（src/shared）
 * 責務: 商品の各項目の形式・範囲・既定値を Zod のスキーマとして一か所に定義する（要件「商品データ」「値の形式」）。
 */
import { z } from 'zod';

/** 商品名の上限の文字数。 */
export const MAXIMUM_PRODUCT_NAME_LENGTH = 200;

/** 金額・送料の上限（円）。桁の打ち間違いを防ぐため 1,000 万円未満とする。 */
export const MAXIMUM_PRICE_YEN = 9_999_999;

/** URL の上限の文字数。 */
export const MAXIMUM_URL_LENGTH = 2048;

/** カテゴリー名の上限の文字数。 */
export const MAXIMUM_CATEGORY_NAME_LENGTH = 50;

/**
 * 商品のステータス。画面では日本語で表示する。
 * - considering: 検討中（初期値）
 * - reserved: 予約済
 * - purchased: 購入済
 * - unpurchased: 未購入
 */
export const PRODUCT_STATUSES = ['considering', 'reserved', 'purchased', 'unpurchased'] as const;

/** 商品のステータスのスキーマ。 */
export const productStatusSchema = z.enum(PRODUCT_STATUSES);

/** 商品のステータス。 */
export type ProductStatus = z.infer<typeof productStatusSchema>;

/** 存在する暦の日付（例: 2026-02-30 は不可）かを確かめる。 */
function isExistingCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** http・https の URL かを確かめる（`javascript:` などのリンクを画面に置かないため）。 */
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** 発売月（年と月。例: 2026-11）。 */
export const releaseMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, '発売月は「2026-11」の形式で入力してください。');

/** 受注期限（日本時間の日付。例: 2026-11-20。その日の終わりまで期限内）。 */
export const orderDeadlineSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '受注期限は「2026-11-20」の形式で入力してください。')
  .refine(isExistingCalendarDate, '受注期限に存在しない日付が指定されています。');

/** 金額・送料（円。0 以上 9,999,999 以下の整数）。 */
export const yenAmountSchema = z
  .number()
  .int('金額は整数で入力してください。')
  .min(0, '金額は 0 円以上で入力してください。')
  .max(MAXIMUM_PRICE_YEN, `金額は ${MAXIMUM_PRICE_YEN.toLocaleString('ja-JP')} 円以下で入力してください。`);

/** 購入先の URL（http・https のみ）。 */
export const productUrlSchema = z
  .string()
  .max(MAXIMUM_URL_LENGTH, `URL は ${MAXIMUM_URL_LENGTH} 文字以内で入力してください。`)
  .refine(isHttpUrl, 'URL は http:// または https:// で始まるものを入力してください。');

/**
 * 商品の入力（登録・編集）のスキーマ。
 * 必須は商品名と発売月。ステータスの既定は検討中、キャンセル可否の既定は不可、任意の項目の既定は未入力（null）。
 */
export const productInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '商品名を入力してください。')
    .max(MAXIMUM_PRODUCT_NAME_LENGTH, `商品名は ${MAXIMUM_PRODUCT_NAME_LENGTH} 文字以内で入力してください。`),
  releaseMonth: releaseMonthSchema,
  status: productStatusSchema.default('considering'),
  cancelable: z.boolean().default(false),
  price: yenAmountSchema.nullable().default(null),
  shippingFee: yenAmountSchema.nullable().default(null),
  orderDeadline: orderDeadlineSchema.nullable().default(null),
  url: productUrlSchema.nullable().default(null),
  category: z.string().trim().min(1).max(MAXIMUM_CATEGORY_NAME_LENGTH).nullable().default(null),
});

/** 検証済みの商品の入力。 */
export type ProductInput = z.infer<typeof productInputSchema>;
