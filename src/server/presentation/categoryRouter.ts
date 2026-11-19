/**
 * カテゴリーの API（/api/categories）。
 *
 * 所属: プレゼンテーション層
 * 責務: カテゴリーの一覧を返す（issue #10）。
 *  - GET /api/categories  定義の並び順の一覧（{ categories }）
 * 定義のファイルに誤りがある場合は 503（CATEGORY_DEFINITION_INVALID）と、ファイル名と誤りの場所を含む理由を返す
 * （利用者がファイルを直す手がかりにするため。中身は利用者自身が書いた定義で、秘密の情報は含まない）。
 */
import express, { type Response } from 'express';
import type { CategoryService } from '../application/categoryService.ts';
import { CategoryDefinitionError } from '../domain/category.ts';
import type { ApiErrorResponse } from '../../shared/productContract.ts';

/**
 * 定義のファイルの誤りを 503 の応答にする。CategoryDefinitionError 以外はそのまま投げる（500 の処理へ）。
 * 商品の API でも使う。
 */
export function sendCategoryDefinitionError(response: Response, error: unknown): void {
  if (!(error instanceof CategoryDefinitionError)) throw error;
  const body: ApiErrorResponse = { error: { code: 'CATEGORY_DEFINITION_INVALID', message: error.message } };
  response.status(503).json(body);
}

/**
 * カテゴリーの API のルーターを作る。
 * @param categoryService カテゴリーの操作
 */
export function createCategoryRouter(categoryService: CategoryService): express.Router {
  const router = express.Router();

  router.get('/', (_request, response) => {
    try {
      response.json({ categories: categoryService.listCategories() });
    } catch (error) {
      sendCategoryDefinitionError(response, error);
    }
  });

  return router;
}
