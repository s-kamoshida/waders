/**
 * 商品の API（/api/products）。
 *
 * 所属: プレゼンテーション層
 * 責務: リクエストの本文を検証して商品の操作を呼び、結果を HTTP の応答にする。
 *  - GET    /api/products             一覧（{ products }）
 *  - POST   /api/products             登録（201）
 *  - PUT    /api/products/:productId  編集（全項目を送る。200）
 *  - DELETE /api/products/:productId  削除（204）
 * 入力の誤りは 400（VALIDATION_ERROR と項目ごとの文言）、存在しない商品は 404（PRODUCT_NOT_FOUND）。
 */
import express, { type Response } from 'express';
import type { ProductService } from '../application/productService.ts';
import { ProductNotFoundError, type ProductId } from '../domain/product.ts';
import { collectFieldErrors, productInputSchema, type ApiErrorResponse, type ProductInput } from '../../shared/productContract.ts';

/** エラーの応答を返す。 */
function sendError(response: Response, status: number, error: ApiErrorResponse['error']): void {
  const body: ApiErrorResponse = { error };
  response.status(status).json(body);
}

/** 本文を検証する。誤りがあれば 400 を返して undefined を返す。 */
function parseProductInput(requestBody: unknown, response: Response): ProductInput | undefined {
  const result = productInputSchema.safeParse(requestBody);
  if (result.success) return result.data;
  sendError(response, 400, {
    code: 'VALIDATION_ERROR',
    message: '入力に誤りがあります。',
    fieldErrors: collectFieldErrors(result.error),
  });
  return undefined;
}

/** 商品の操作を行い、商品が存在しなければ 404 を返す。 */
function respondProductNotFound(response: Response): void {
  sendError(response, 404, { code: 'PRODUCT_NOT_FOUND', message: '商品が見つかりません。削除された可能性があります。' });
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
    const input = parseProductInput(request.body, response);
    if (input === undefined) return;
    response.status(201).json(productService.createProduct(input));
  });

  router.put('/:productId', (request, response) => {
    const input = parseProductInput(request.body, response);
    if (input === undefined) return;
    try {
      response.json(productService.updateProduct(request.params.productId as ProductId, input));
    } catch (error) {
      if (!(error instanceof ProductNotFoundError)) throw error;
      respondProductNotFound(response);
    }
  });

  router.delete('/:productId', (request, response) => {
    try {
      productService.deleteProduct(request.params.productId as ProductId);
      response.status(204).end();
    } catch (error) {
      if (!(error instanceof ProductNotFoundError)) throw error;
      respondProductNotFound(response);
    }
  });

  return router;
}
