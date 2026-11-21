/**
 * カテゴリーの API（/api/categories）。
 *
 * 所属: プレゼンテーション層
 * 責務: カテゴリーの一覧と、カテゴリーの管理（追加・改名・削除・定義にないカテゴリーの扱い）を HTTP の応答にする（issue #10）。
 *  - GET    /api/categories                                 定義の並び順の一覧（{ categories }）
 *  - POST   /api/categories                                 追加（{ name }。201 と追加したカテゴリー）
 *  - PUT    /api/categories/:categoryId                     改名（{ name }。200 と改名したカテゴリー。商品の名前も追従する）
 *  - DELETE /api/categories/:categoryId                     削除（{ moveToCategoryId }。204。商品は移す先か未設定にする）
 *  - POST   /api/categories/:categoryId/add-to-definition   定義にないカテゴリーを定義に戻す（201 とカテゴリー）
 *  - POST   /api/categories/:categoryId/reassign-products   定義にないカテゴリーの商品を付け替える（{ moveToCategoryId }。204）
 *  - PATCH  /api/categories/:categoryId/field-settings      入力項目と「その他費用」の名前を変える（{ fields?, otherExpenseLabel? }。200 とカテゴリー。issue #27）
 * 定義のファイルに誤りがある場合は 503（CATEGORY_DEFINITION_INVALID）と、ファイル名と誤りの場所を含む理由を返す
 * （利用者がファイルを直す手がかりにするため。中身は利用者自身が書いた定義で、秘密の情報は含まない）。
 * そのほかのエラーの対応は CATEGORY_ERROR_RESPONSES を参照。
 */
import express, { type Response } from 'express';
import type { z } from 'zod';
import type { CategoryService } from '../application/categoryService.ts';
import type { ProductService } from '../application/productService.ts';
import {
  CategoryAlreadyDefinedError,
  CategoryDefinitionError,
  CategoryDestinationNotFoundError,
  CategoryNameDuplicateError,
  CategoryNotFoundError,
} from '../domain/category.ts';
import {
  categoryFieldSettingsRequestSchema,
  categoryNameRequestSchema,
  categoryReassignRequestSchema,
} from '../../shared/categoryContract.ts';
import { collectFieldErrors, type ApiErrorResponse } from '../../shared/productContract.ts';

/** カテゴリーが見つからない場合の文言（画面にそのまま表示する）。 */
const CATEGORY_NOT_FOUND_MESSAGE = 'カテゴリーが見つかりません。ページを読み込み直してください。';

/**
 * 定義のファイルの誤りを 503 の応答にする。CategoryDefinitionError 以外はそのまま投げる（500 の処理へ）。
 * 商品の API でも使う。
 */
export function sendCategoryDefinitionError(response: Response, error: unknown): void {
  if (!(error instanceof CategoryDefinitionError)) throw error;
  const body: ApiErrorResponse = { error: { code: 'CATEGORY_DEFINITION_INVALID', message: error.message } };
  response.status(503).json(body);
}

/** エラーの応答を返す。 */
function sendError(response: Response, status: number, error: ApiErrorResponse['error']): void {
  const body: ApiErrorResponse = { error };
  response.status(status).json(body);
}

/** 本文をスキーマで検証する。誤りがあれば 400 を返して undefined を返す。 */
function parseRequestBody<Schema extends z.ZodType>(schema: Schema, requestBody: unknown, response: Response): z.infer<Schema> | undefined {
  const result = schema.safeParse(requestBody);
  if (result.success) return result.data;
  sendError(response, 400, { code: 'VALIDATION_ERROR', message: '入力に誤りがあります。', fieldErrors: collectFieldErrors(result.error) });
  return undefined;
}

/** カテゴリーの操作のエラーと、その応答（HTTP の状態と、エラーから作る本文）。 */
const CATEGORY_ERROR_RESPONSES: readonly {
  readonly errorClass: new (...parameters: never[]) => Error;
  readonly status: number;
  readonly createError: (error: Error) => ApiErrorResponse['error'];
}[] = [
  {
    errorClass: CategoryNotFoundError,
    status: 404,
    createError: () => ({ code: 'CATEGORY_NOT_FOUND', message: CATEGORY_NOT_FOUND_MESSAGE }),
  },
  {
    errorClass: CategoryDestinationNotFoundError,
    status: 400,
    createError: () => ({
      code: 'CATEGORY_NOT_FOUND',
      message: CATEGORY_NOT_FOUND_MESSAGE,
      fieldErrors: { moveToCategoryId: CATEGORY_NOT_FOUND_MESSAGE },
    }),
  },
  {
    errorClass: CategoryNameDuplicateError,
    status: 409,
    createError: (error) => {
      const message = `カテゴリー「${(error as CategoryNameDuplicateError).categoryName}」はすでにあります。`;
      return { code: 'CATEGORY_NAME_DUPLICATE', message, fieldErrors: { name: message } };
    },
  },
  {
    errorClass: CategoryAlreadyDefinedError,
    status: 409,
    createError: () => ({ code: 'CATEGORY_ALREADY_DEFINED', message: 'このカテゴリーはすでに定義にあります。ページを読み込み直してください。' }),
  },
];

/** カテゴリーの操作を行い、結果を応答にする。エラーは対応する応答にし、想定外のエラーはそのまま投げる（500 の処理へ）。 */
function respondWithCategoryOperation(response: Response, operation: () => void): void {
  try {
    operation();
  } catch (error) {
    if (error instanceof CategoryDefinitionError) {
      sendCategoryDefinitionError(response, error);
      return;
    }
    const matched = CATEGORY_ERROR_RESPONSES.find((candidate) => error instanceof candidate.errorClass);
    if (matched === undefined || !(error instanceof Error)) throw error;
    sendError(response, matched.status, matched.createError(error));
  }
}

/**
 * カテゴリーの API のルーターを作る。
 * @param categoryService カテゴリーの操作（一覧・追加）
 * @param productService 商品の操作（商品の更新を伴う改名・削除・定義にないカテゴリーの扱い）
 */
export function createCategoryRouter(categoryService: CategoryService, productService: ProductService): express.Router {
  const router = express.Router();

  router.get('/', (_request, response) => {
    respondWithCategoryOperation(response, () => {
      response.json({ categories: categoryService.listCategories() });
    });
  });

  router.post('/', (request, response) => {
    const nameRequest = parseRequestBody(categoryNameRequestSchema, request.body, response);
    if (nameRequest === undefined) return;
    respondWithCategoryOperation(response, () => {
      response.status(201).json(categoryService.addCategory(nameRequest.name));
    });
  });

  router.put('/:categoryId', (request, response) => {
    const nameRequest = parseRequestBody(categoryNameRequestSchema, request.body, response);
    if (nameRequest === undefined) return;
    respondWithCategoryOperation(response, () => {
      response.json(productService.renameCategory(request.params.categoryId, nameRequest.name));
    });
  });

  router.delete('/:categoryId', (request, response) => {
    const reassignRequest = parseRequestBody(categoryReassignRequestSchema, request.body, response);
    if (reassignRequest === undefined) return;
    respondWithCategoryOperation(response, () => {
      productService.deleteCategory(request.params.categoryId, reassignRequest.moveToCategoryId);
      response.status(204).end();
    });
  });

  router.post('/:categoryId/add-to-definition', (request, response) => {
    respondWithCategoryOperation(response, () => {
      response.status(201).json(productService.addUndefinedCategoryToDefinition(request.params.categoryId));
    });
  });

  router.post('/:categoryId/reassign-products', (request, response) => {
    const reassignRequest = parseRequestBody(categoryReassignRequestSchema, request.body, response);
    if (reassignRequest === undefined) return;
    respondWithCategoryOperation(response, () => {
      productService.reassignUndefinedCategoryProducts(request.params.categoryId, reassignRequest.moveToCategoryId);
      response.status(204).end();
    });
  });

  router.patch('/:categoryId/field-settings', (request, response) => {
    const changes = parseRequestBody(categoryFieldSettingsRequestSchema, request.body, response);
    if (changes === undefined) return;
    respondWithCategoryOperation(response, () => {
      response.json(categoryService.updateCategoryFieldSettings(request.params.categoryId, changes));
    });
  });

  return router;
}
