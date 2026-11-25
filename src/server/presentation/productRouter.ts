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
 *  - PATCH  /api/products/:productId/release-month          発売月だけを変える（200。ドラッグアンドドロップ。issue #13）
 *  - PUT    /api/products/:productId/image  画像を付ける・差し替える（本文は { data: base64 }。200。issue #41）
 *  - DELETE /api/products/:productId/image  画像を消す（204。issue #41）
 *  - GET    /api/products/:productId/image  画像の中身（中身から判定した形式の Content-Type。issue #41）
 * 商品を返す応答には、画像の URL（imageUrl。画像を付け直すたびに変わる版を含む）を付ける（issue #41）。
 * 入力の誤りは 400（VALIDATION_ERROR と項目ごとの文言）、存在しない商品は 404（PRODUCT_NOT_FOUND）。
 * 業務ルールに反する操作のエラーの対応は PRODUCT_ERROR_RESPONSES を参照。カテゴリーの定義のファイルの誤りは 503（issue #10）。
 */
import express, { type Response } from 'express';
import type { z } from 'zod';
import type { ProductService } from '../application/productService.ts';
import { CategoryDefinitionError, CategoryNotFoundError } from '../domain/category.ts';
import {
  ArchivedReleaseMonthChangeError,
  DeliveryConfirmationNotPendingError,
  ProductNotArchivedError,
  ProductNotFoundError,
  RestoreReleaseMonthInPastError,
  type ProductId,
  type Product,
} from '../domain/product.ts';
import { PRODUCT_IMAGE_CONTENT_TYPES, ProductImageTooLargeError, UnsupportedProductImageError } from '../domain/productImage.ts';
import { sendCategoryDefinitionError } from './categoryRouter.ts';
import {
  collectFieldErrors,
  deliveryConfirmationRequestSchema,
  productImageUploadRequestSchema,
  productInputSchema,
  releaseMonthChangeRequestSchema,
  restoreRequestSchema,
  type ApiErrorResponse,
  type ProductResponse,
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
    errorClass: CategoryNotFoundError,
    status: 400,
    error: {
      code: 'CATEGORY_NOT_FOUND',
      message: 'カテゴリーが見つかりません。ページを読み込み直してください。',
      fieldErrors: { categoryId: 'カテゴリーが見つかりません。ページを読み込み直してください。' },
    },
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
  {
    errorClass: ProductImageTooLargeError,
    status: 413,
    error: { code: 'IMAGE_TOO_LARGE', message: '画像が大きすぎます。2MB 以下にしてください。' },
  },
  {
    errorClass: UnsupportedProductImageError,
    status: 400,
    error: { code: 'UNSUPPORTED_IMAGE', message: '画像は JPEG・PNG・WebP のどれかにしてください。' },
  },
];

/** 画像の URL（API のパスと、画像の版）。画像がなければ null（issue #41）。 */
function buildImageUrl(productId: ProductId, imageVersion: string | null): string | null {
  if (imageVersion === null) return null;
  return `/api/products/${encodeURIComponent(productId)}/image?v=${encodeURIComponent(imageVersion)}`;
}

/** 商品の操作のエラーを対応する応答にする。想定外のエラーはそのまま投げる（500 の処理へ）。 */
function sendProductError(response: Response, error: unknown): void {
  if (error instanceof CategoryDefinitionError) {
    sendCategoryDefinitionError(response, error);
    return;
  }
  const matched = PRODUCT_ERROR_RESPONSES.find((candidate) => error instanceof candidate.errorClass);
  if (matched === undefined) throw error;
  sendError(response, matched.status, matched.error);
}

/**
 * 商品の操作を行い、結果の商品に画像の URL を付けて JSON で返す。エラーは sendProductError で応答にする。
 * @param status 成功したときの HTTP の状態
 */
function respondWithProductOperation(
  response: Response,
  productService: ProductService,
  operation: () => Product,
  status = 200,
): void {
  try {
    const product = operation();
    const body: ProductResponse = { ...product, imageUrl: buildImageUrl(product.id, productService.findProductImageVersion(product.id)) };
    response.status(status).json(body);
  } catch (error) {
    sendProductError(response, error);
  }
}

/** 本文のない応答（204）を返す操作を行う。エラーは sendProductError で応答にする。 */
function respondWithoutContent(response: Response, operation: () => void): void {
  try {
    operation();
    response.status(204).end();
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
    const products = productService.listProducts();
    const imageVersions = productService.listProductImageVersions();
    response.json({
      products: products.map((product) => ({ ...product, imageUrl: buildImageUrl(product.id, imageVersions.get(product.id) ?? null) })),
    });
  });

  router.post('/', (request, response) => {
    const input = parseRequestBody(productInputSchema, request.body, response);
    if (input === undefined) return;
    respondWithProductOperation(response, productService, () => productService.createProduct(input), 201);
  });

  router.put('/:productId', (request, response) => {
    const input = parseRequestBody(productInputSchema, request.body, response);
    if (input === undefined) return;
    respondWithProductOperation(response, productService, () => productService.updateProduct(request.params.productId as ProductId, input));
  });

  router.delete('/:productId', (request, response) => {
    respondWithoutContent(response, () => productService.deleteProduct(request.params.productId as ProductId));
  });

  router.put('/:productId/image', (request, response) => {
    const upload = parseRequestBody(productImageUploadRequestSchema, request.body, response);
    if (upload === undefined) return;
    const bytes = Buffer.from(upload.data, 'base64');
    respondWithProductOperation(response, productService, () => productService.saveProductImage(request.params.productId as ProductId, bytes));
  });

  router.delete('/:productId/image', (request, response) => {
    respondWithoutContent(response, () => productService.deleteProductImage(request.params.productId as ProductId));
  });

  router.get('/:productId/image', (request, response) => {
    const productId = request.params.productId as ProductId;
    const image = productService.readProductImage(productId);
    if (image === undefined) {
      sendError(response, 404, { code: 'IMAGE_NOT_FOUND', message: '画像がありません。' });
      return;
    }
    // 版を付けた URL の中身は変わらない（付け直すと版が変わる）ため、長く覚えさせる。版がない・古い URL は毎回確かめさせる
    const isCurrentVersion = request.query.v === productService.findProductImageVersion(productId);
    response.setHeader('Cache-Control', isCurrentVersion ? 'private, max-age=31536000, immutable' : 'private, no-cache');
    response.setHeader('Content-Type', PRODUCT_IMAGE_CONTENT_TYPES[image.format]);
    response.send(Buffer.from(image.bytes));
  });

  router.post('/:productId/restore', (request, response) => {
    const restoreRequest = parseRequestBody(restoreRequestSchema, request.body, response);
    if (restoreRequest === undefined) return;
    respondWithProductOperation(response, productService, () =>
      productService.restoreProduct(request.params.productId as ProductId, restoreRequest.releaseMonth),
    );
  });

  router.patch('/:productId/release-month', (request, response) => {
    const change = parseRequestBody(releaseMonthChangeRequestSchema, request.body, response);
    if (change === undefined) return;
    respondWithProductOperation(response, productService, () =>
      productService.moveProductToReleaseMonth(request.params.productId as ProductId, change.releaseMonth),
    );
  });

  router.post('/:productId/delivery-confirmation', (request, response) => {
    const answer = parseRequestBody(deliveryConfirmationRequestSchema, request.body, response);
    if (answer === undefined) return;
    respondWithProductOperation(response, productService, () => productService.answerDeliveryConfirmation(request.params.productId as ProductId, answer));
  });

  return router;
}
