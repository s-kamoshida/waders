/**
 * カテゴリーの形式（クライアントとサーバーで共用）。
 *
 * 所属: 共有（src/shared）
 * 責務: カテゴリーの名前・ID の形式と、カテゴリーの API の要求・応答を Zod のスキーマとして定義する（issue #10）。
 * カテゴリーごとに出し入れできる入力項目と、「その他費用」の名前の形式も定義する（issue #27）。
 */
import { z } from 'zod';
import { MAXIMUM_CATEGORY_ID_LENGTH, MAXIMUM_CATEGORY_NAME_LENGTH } from './productContract.ts';

export { MAXIMUM_CATEGORY_ID_LENGTH } from './productContract.ts';

/** カテゴリー名（前後の空白を除いて 1〜50 文字）。 */
export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, 'カテゴリー名を入力してください。')
  .max(MAXIMUM_CATEGORY_NAME_LENGTH, `カテゴリー名は ${MAXIMUM_CATEGORY_NAME_LENGTH} 文字以内で入力してください。`);

/** カテゴリーの ID（1〜100 文字）。 */
export const categoryIdSchema = z.string().min(1).max(MAXIMUM_CATEGORY_ID_LENGTH);

/**
 * カテゴリーごとに出し入れできる入力項目（issue #27）。この並びが、定義・API・画面での並び順になる。
 * eventPeriod は開催日時と終了日時の 1 組（PR #30 のレビュー）。
 * 商品名・発売月・ステータス・カテゴリー・金額・URL・備考は常に入力するため含めない。
 */
export const CATEGORY_CONTROLLED_FIELDS = [
  'shippingFee',
  'maker',
  'orderDeadline',
  'cancelable',
  'location',
  'eventPeriod',
  'handlingFee',
  'travelExpense',
  'otherExpense',
] as const;

/** 出し入れできる入力項目の名前のスキーマ。 */
export const categoryControlledFieldSchema = z.enum(CATEGORY_CONTROLLED_FIELDS);

/** 出し入れできる入力項目の名前。 */
export type CategoryControlledField = z.infer<typeof categoryControlledFieldSchema>;

/**
 * 項目の指定がないカテゴリー（今までの定義・画面で追加したカテゴリー）と、カテゴリー未設定・定義にないカテゴリーの商品で
 * 有効な項目。今までの表示を変えないよう、既存の項目だけを有効にする。
 */
export const DEFAULT_ENABLED_FIELDS: readonly CategoryControlledField[] = ['shippingFee', 'maker', 'orderDeadline', 'cancelable'];

/** 「その他費用」の名前を変えていない場合の名前。 */
export const DEFAULT_OTHER_EXPENSE_LABEL = 'その他費用';

/** 「その他費用」の名前の上限の文字数。 */
export const MAXIMUM_OTHER_EXPENSE_LABEL_LENGTH = 20;

/** 「その他費用」の名前（前後の空白を除いて 1〜20 文字）。 */
export const otherExpenseLabelSchema = z
  .string()
  .trim()
  .min(1, 'その他費用の名前を入力しない場合は空にしてください。')
  .max(MAXIMUM_OTHER_EXPENSE_LABEL_LENGTH, `その他費用の名前は ${MAXIMUM_OTHER_EXPENSE_LABEL_LENGTH} 文字以内で入力してください。`);

/**
 * 出し入れできる項目を、決まった並び（CATEGORY_CONTROLLED_FIELDS の順）で重なりなく並べる。
 * @param fields 有効にする項目（順不同・重なりがあってもよい）
 */
export function sortCategoryControlledFields(fields: Iterable<CategoryControlledField>): CategoryControlledField[] {
  const enabledFields = new Set(fields);
  return CATEGORY_CONTROLLED_FIELDS.filter((field) => enabledFields.has(field));
}

/**
 * API が返すカテゴリーのスキーマ。fields は有効な入力項目、otherExpenseLabel は「その他費用」の名前（issue #27）。
 * 応答に fields・otherExpenseLabel がない場合は、定義のファイルで省略した場合と同じ既定とみなす。
 */
export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  fields: z.array(categoryControlledFieldSchema).default(() => [...DEFAULT_ENABLED_FIELDS]),
  otherExpenseLabel: z.string().default(DEFAULT_OTHER_EXPENSE_LABEL),
});

/** API が返すカテゴリー。 */
export type CategoryResponse = z.infer<typeof categorySchema>;

/** カテゴリーの一覧（GET /api/categories）の応答のスキーマ。定義のファイルの並び順。 */
export const categoryListResponseSchema = z.object({ categories: z.array(categorySchema) });

/** カテゴリーの追加・改名（POST /api/categories・PUT /api/categories/:categoryId）の本文のスキーマ。 */
export const categoryNameRequestSchema = z.object({ name: categoryNameSchema });

/**
 * カテゴリーの削除・定義にないカテゴリーの付け替え（DELETE /api/categories/:categoryId・
 * POST /api/categories/:categoryId/reassign-products）の本文のスキーマ。
 * moveToCategoryId は商品の移す先のカテゴリーの ID。null ならカテゴリー未設定にする。
 */
export const categoryReassignRequestSchema = z.object({ moveToCategoryId: categoryIdSchema.nullable() });

/**
 * カテゴリーの入力項目の設定の変更（PATCH /api/categories/:categoryId/field-settings。issue #27）の本文のスキーマ。
 * fields は変える項目だけを持つ（true で有効、false で無効）。otherExpenseLabel が null なら「その他費用」に戻す。
 * どちらも省略できる（省略した項目は変えない）。
 */
export const categoryFieldSettingsRequestSchema = z.object({
  fields: z
    .strictObject({
      shippingFee: z.boolean().optional(),
      maker: z.boolean().optional(),
      orderDeadline: z.boolean().optional(),
      cancelable: z.boolean().optional(),
      location: z.boolean().optional(),
      eventPeriod: z.boolean().optional(),
      handlingFee: z.boolean().optional(),
      travelExpense: z.boolean().optional(),
      otherExpense: z.boolean().optional(),
    })
    .optional(),
  otherExpenseLabel: otherExpenseLabelSchema.nullable().optional(),
});

/** カテゴリーの入力項目の設定の変更。 */
export type CategoryFieldSettingsChange = z.infer<typeof categoryFieldSettingsRequestSchema>;
