/**
 * 商品の API の呼び出し。
 *
 * 所属: クライアント
 * 責務: /api/products を呼び、応答を検証して返す。失敗した場合は ApiRequestError にする。
 * 状態を変える要求には、本文がなくても Content-Type: application/json を付ける（サーバーの CSRF 対策の条件）。
 */
import {
  apiErrorResponseSchema,
  productListResponseSchema,
  productSchema,
  type DeliveryConfirmationRequest,
  type ProductInput,
  type ProductListItem,
  type ProductResponse,
} from '../shared/productContract.ts';

/** API の呼び出しの失敗。サーバーが入力の誤りを返した場合は fieldErrors に項目ごとの文言が入る。 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(status: number, code: string, message: string, fieldErrors: Readonly<Record<string, string>> = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

/** API を呼び、本文（JSON）を返す。本文がなければ undefined。 */
async function sendApiRequest(method: string, path: string, requestBody?: unknown): Promise<unknown> {
  const isStateChanging = method !== 'GET';
  const response = await fetch(path, {
    method,
    headers: isStateChanging ? { 'Content-Type': 'application/json' } : undefined,
    body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const parsedError = apiErrorResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsedError.success) throw new ApiRequestError(response.status, 'UNKNOWN_ERROR', `HTTP ${response.status}`);
    const { code, message, fieldErrors } = parsedError.data.error;
    throw new ApiRequestError(response.status, code, message, fieldErrors);
  }
  if (response.status === 204) return undefined;
  return response.json();
}

/** 商品の一覧を取得する（サーバーが自動遷移を反映した後の状態。延期の確認待ちかを含む）。 */
export async function fetchProducts(): Promise<ProductListItem[]> {
  return productListResponseSchema.parse(await sendApiRequest('GET', '/api/products')).products;
}

/** 商品を登録する。 */
export async function createProduct(input: ProductInput): Promise<ProductResponse> {
  return productSchema.parse(await sendApiRequest('POST', '/api/products', input));
}

/** 商品を更新する。 */
export async function updateProduct(productId: string, input: ProductInput): Promise<ProductResponse> {
  return productSchema.parse(await sendApiRequest('PUT', `/api/products/${encodeURIComponent(productId)}`, input));
}

/** 商品を削除する。 */
export async function deleteProduct(productId: string): Promise<void> {
  await sendApiRequest('DELETE', `/api/products/${encodeURIComponent(productId)}`);
}

/** アーカイブされた商品を、新しい発売月でリストに戻す（issue #9）。 */
export async function restoreProduct(productId: string, releaseMonth: string): Promise<ProductResponse> {
  return productSchema.parse(await sendApiRequest('POST', `/api/products/${encodeURIComponent(productId)}/restore`, { releaseMonth }));
}

/** 延期の確認に回答する（issue #9）。 */
export async function answerDeliveryConfirmation(productId: string, answer: DeliveryConfirmationRequest): Promise<ProductResponse> {
  return productSchema.parse(
    await sendApiRequest('POST', `/api/products/${encodeURIComponent(productId)}/delivery-confirmation`, answer),
  );
}
