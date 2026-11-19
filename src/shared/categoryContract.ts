/**
 * カテゴリーの形式（クライアントとサーバーで共用）。
 *
 * 所属: 共有（src/shared）
 * 責務: カテゴリーの名前・ID の形式と、カテゴリーの API の応答を Zod のスキーマとして定義する（issue #10）。
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

/** API が返すカテゴリーのスキーマ。 */
export const categorySchema = z.object({ id: z.string(), name: z.string() });

/** API が返すカテゴリー。 */
export type CategoryResponse = z.infer<typeof categorySchema>;

/** カテゴリーの一覧（GET /api/categories）の応答のスキーマ。定義のファイルの並び順。 */
export const categoryListResponseSchema = z.object({ categories: z.array(categorySchema) });
