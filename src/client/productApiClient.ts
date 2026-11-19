/**
 * 商品の API の呼び出し。
 *
 * 所属: クライアント
 * 責務: /api/products・/api/categories を呼び、応答を検証して返す。失敗した場合は ApiRequestError にする。
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
import { categoryListResponseSchema, categorySchema, type CategoryResponse } from '../shared/categoryContract.ts';

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

/**
 * カテゴリーの一覧を、定義の並び順で取得する（issue #10）。
 * @throws {ApiRequestError} 定義のファイルに誤りがある場合（code が CATEGORY_DEFINITION_INVALID、message に理由）など
 */
export async function fetchCategories(): Promise<CategoryResponse[]> {
  return categoryListResponseSchema.parse(await sendApiRequest('GET', '/api/categories')).categories;
}

/** 発売月だけを変える（ドラッグアンドドロップ。issue #13）。 */
export async function moveProductToReleaseMonth(productId: string, releaseMonth: string): Promise<ProductResponse> {
  return productSchema.parse(
    await sendApiRequest('PATCH', `/api/products/${encodeURIComponent(productId)}/release-month`, { releaseMonth }),
  );
}

/** カテゴリーの API のパス（ID は URL に使えるよう符号化する）。 */
function buildCategoryPath(categoryId: string, suffix = ''): string {
  return `/api/categories/${encodeURIComponent(categoryId)}${suffix}`;
}

/** カテゴリーを定義の末尾に加える（issue #10）。 */
export async function addCategory(name: string): Promise<CategoryResponse> {
  return categorySchema.parse(await sendApiRequest('POST', '/api/categories', { name }));
}

/** カテゴリーを改名する。そのカテゴリーの商品も新しい名前に追従する（issue #10）。 */
export async function renameCategory(categoryId: string, name: string): Promise<CategoryResponse> {
  return categorySchema.parse(await sendApiRequest('PUT', buildCategoryPath(categoryId), { name }));
}

/**
 * カテゴリーを削除する（issue #10）。
 * @param moveToCategoryId そのカテゴリーの商品の移す先。null ならカテゴリー未設定にする
 */
export async function deleteCategory(categoryId: string, moveToCategoryId: string | null): Promise<void> {
  await sendApiRequest('DELETE', buildCategoryPath(categoryId), { moveToCategoryId });
}

/** 定義にないカテゴリーを、同じ ID と最後に保存した名前で定義に加える（issue #10）。 */
export async function addUndefinedCategoryToDefinition(categoryId: string): Promise<CategoryResponse> {
  return categorySchema.parse(await sendApiRequest('POST', buildCategoryPath(categoryId, '/add-to-definition')));
}

/**
 * 定義にないカテゴリーのすべての商品を付け替える（issue #10）。
 * @param moveToCategoryId 移す先。null ならカテゴリー未設定にする
 */
export async function reassignUndefinedCategoryProducts(categoryId: string, moveToCategoryId: string | null): Promise<void> {
  await sendApiRequest('POST', buildCategoryPath(categoryId, '/reassign-products'), { moveToCategoryId });
}
