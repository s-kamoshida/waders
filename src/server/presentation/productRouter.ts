/**
 * 商品の API（/api/products）。
 *
 * 所属: プレゼンテーション層
 * 責務: リクエストの本文を検証して商品の操作を呼び、結果を HTTP の応答にする。
 *  - GET    /api/products             一覧（{ products }）
 *  - POST   /api/products             登録（201）
 *  - PUT    /api/products/:productId  編集（全項目を送る。200）
 *  - DELETE /api/products/:productId  削除（204）
 *  - POST   /api/products/:productId/restore                リストに戻す（200。issue #9）
 *  - POST   /api/products/:productId/delivery-confirmation  延期の確認への回答（200。issue #9）
 * 入力の誤りは 400（VALIDATION_ERROR と項目ごとの文言）、存在しない商品は 404（PRODUCT_NOT_FOUND）。
 * 業務ルールに反する操作のエラーの対応は PRODUCT_ERROR_RESPONSES を参照。
 */
import express, { type Response } from 'express';
import type { z } from 'zod';
import type { ProductService } from '../application/productService.ts';
import {
  ArchivedReleaseMonthChangeError,
  DeliveryConfirmationNotPendingError,
  ProductNotArchivedError,
  ProductNotFoundError,
  RestoreReleaseMonthInPastError,
  type ProductId,
} from '../domain/product.ts';
import {
  collectFieldErrors,
  deliveryConfirmationRequestSchema,
  productInputSchema,
  restoreRequestSchema,
  type ApiErrorResponse,
} from '../../shared/productContract.ts';

/** エラーの応答を返す。 */
function sendError(response: Response, status: number, error: ApiErrorResponse['error']): void {
  const body: ApiErrorResponse = { error };
  response.status(status).json(body);
}

/** 本文をスキーマで検証する。誤りがあれば 400 を返して undefined を返す。 */
function parseRequestBody<Schema extends z.ZodType>(schema: Schema, requestBody: unknown, response: Response): z.infer<Schema> | undefined {
  const result = schema.safeParse(requestBody);
  if (result.success) return result.data;
  sendError(response, 400, {
    code: 'VALIDATION_ERROR',
    message: '入力に誤りがあります。',
    fieldErrors: collectFieldErrors(result.error),
  });
  return undefined;
}

/** 商品の操作のエラーと、その応答（HTTP の状態・コード・文言）。 */
const PRODUCT_ERROR_RESPONSES: readonly {
  readonly errorClass: new (...parameters: never[]) => Error;
  readonly status: number;
  readonly error: ApiErrorResponse['error'];
}[] = [
  {
    errorClass: ProductNotFoundError,
    status: 404,
    error: { code: 'PRODUCT_NOT_FOUND', message: '商品が見つかりません。削除された可能性があります。' },
  },
  {
    errorClass: ProductNotArchivedError,
    status: 409,
    error: { code: 'PRODUCT_NOT_ARCHIVED', message: 'この商品はアーカイブされていません。ページを読み込み直してください。' },
  },
  {
    errorClass: RestoreReleaseMonthInPastError,
    status: 400,
    error: {
      code: 'RELEASE_MONTH_IN_PAST',
      message: '発売月は当月以降を指定してください。',
      fieldErrors: { releaseMonth: '発売月は当月以降を指定してください。' },
    },
  },
  {
    errorClass: DeliveryConfirmationNotPendingError,
    status: 409,
    error: { code: 'DELIVERY_CONFIRMATION_NOT_PENDING', message: 'この商品は回答済みです。ページを読み込み直してください。' },
  },
  {
    errorClass: ArchivedReleaseMonthChangeError,
    status: 400,
    error: {
      code: 'ARCHIVED_RELEASE_MONTH_CHANGE',
      message: 'アーカイブされた商品の発売月は「リストに戻す」で変更してください。',
      fieldErrors: { releaseMonth: 'アーカイブされた商品の発売月は「リストに戻す」で変更してください。' },
    },
  },
];

/** 商品の操作のエラーを対応する応答にする。想定外のエラーはそのまま投げる（500 の処理へ）。 */
function sendProductError(response: Response, error: unknown): void {
  const matched = PRODUCT_ERROR_RESPONSES.find((candidate) => error instanceof candidate.errorClass);
  if (matched === undefined) throw error;
  sendError(response, matched.status, matched.error);
}

/** 商品の操作を行い、結果を JSON で返す。エラーは sendProductError で応答にする。 */
function respondWithProductOperation(response: Response, operation: () => unknown): void {
  try {
    response.json(operation());
  } catch (error) {
    sendProductError(response, error);
  }
}

/**
 * 商品の API のルーターを作る。
 * @param productService 商品の操作
 */
export function createProductRouter(productService: ProductService): express.Router {
  const router = express.Router();

  router.get('/', (_request, response) => {
    response.json({ products: productService.listProducts() });
  });

  router.post('/', (request, response) => {
    const input = parseRequestBody(productInputSchema, request.body, response);
    if (input === undefined) return;
    response.status(201).json(productService.createProduct(input));
  });

  router.put('/:productId', (request, response) => {
    const input = parseRequestBody(productInputSchema, request.body, response);
    if (input === undefined) return;
    respondWithProductOperation(response, () => productService.updateProduct(request.params.productId as ProductId, input));
  });

  router.delete('/:productId', (request, response) => {
    try {
      productService.deleteProduct(request.params.productId as ProductId);
      response.status(204).end();
    } catch (error) {
      sendProductError(response, error);
    }
  });

  router.post('/:productId/restore', (request, response) => {
    const restoreRequest = parseRequestBody(restoreRequestSchema, request.body, response);
    if (restoreRequest === undefined) return;
    respondWithProductOperation(response, () =>
      productService.restoreProduct(request.params.productId as ProductId, restoreRequest.releaseMonth),
    );
  });

  router.post('/:productId/delivery-confirmation', (request, response) => {
    const answer = parseRequestBody(deliveryConfirmationRequestSchema, request.body, response);
    if (answer === undefined) return;
    respondWithProductOperation(response, () => productService.answerDeliveryConfirmation(request.params.productId as ProductId, answer));
  });

  return router;
}
