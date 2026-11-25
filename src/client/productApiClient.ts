/**
 * API の呼び出し（商品・カテゴリー・認証）。
 *
 * 所属: クライアント
 * 責務: /api/products・/api/categories・/api/auth を呼び、応答を検証して返す。失敗した場合は ApiRequestError にする。
 * ログインが必要（401 AUTHENTICATION_REQUIRED）と返された場合は、登録された関数で画面に知らせる（issue #11）。
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
import {
  categoryListResponseSchema,
  categorySchema,
  type CategoryFieldSettingsChange,
  type CategoryResponse,
} from '../shared/categoryContract.ts';
import { authenticationStatusSchema, type AuthenticationStatus } from '../shared/authenticationContract.ts';

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

/** ログインが必要と返されたときに呼ぶ関数（画面の最上位が登録する）。 */
let authenticationRequiredListener: (() => void) | undefined;

/**
 * API がログインを求めた（ログインの期限切れなど）ときに呼ぶ関数を登録する（issue #11）。
 * @returns 登録を解除する関数
 */
export function listenAuthenticationRequired(listener: () => void): () => void {
  authenticationRequiredListener = listener;
  return () => {
    if (authenticationRequiredListener === listener) authenticationRequiredListener = undefined;
  };
}

/**
 * API のパス（`/api/...`）を、画面を開いているパスの下のパスにする。
 * 画面を `/waders/` や `/waders/archive` で開いていれば `/waders/api/...` になる（サーバーの設定の basePath に合わせる。issue #39）。
 */
function resolveApiPath(path: string): string {
  const resolvedUrl = new URL(`.${path}`, document.baseURI);
  return `${resolvedUrl.pathname}${resolvedUrl.search}`;
}

/** API を呼び、本文（JSON）を返す。本文がなければ undefined。 */
async function sendApiRequest(method: string, path: string, requestBody?: unknown): Promise<unknown> {
  const isStateChanging = method !== 'GET';
  const response = await fetch(resolveApiPath(path), {
    method,
    headers: isStateChanging ? { 'Content-Type': 'application/json' } : undefined,
    body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const parsedError = apiErrorResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsedError.success) throw new ApiRequestError(response.status, 'UNKNOWN_ERROR', `HTTP ${response.status}`);
    const { code, message, fieldErrors } = parsedError.data.error;
    if (response.status === 401 && code === 'AUTHENTICATION_REQUIRED') authenticationRequiredListener?.();
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

/**
 * カテゴリーの入力項目と「その他費用」の名前のうち、指定したものだけを変える（issue #27）。
 * @param changes 変える項目（fields は変える項目だけ。otherExpenseLabel が null なら「その他費用」に戻す）
 */
export async function updateCategoryFieldSettings(categoryId: string, changes: CategoryFieldSettingsChange): Promise<CategoryResponse> {
  return categorySchema.parse(await sendApiRequest('PATCH', buildCategoryPath(categoryId, '/field-settings'), changes));
}

/** 認証の状態を取得する（issue #11）。 */
export async function fetchAuthenticationStatus(): Promise<AuthenticationStatus> {
  return authenticationStatusSchema.parse(await sendApiRequest('GET', '/api/auth/status'));
}

/** アカウントを作り、ログインした状態にする（issue #11）。 */
export async function setUpAccount(loginId: string, password: string): Promise<AuthenticationStatus> {
  return authenticationStatusSchema.parse(await sendApiRequest('POST', '/api/auth/setup', { loginId, password }));
}

/** ログインする（issue #11）。 */
export async function logIn(loginId: string, password: string): Promise<AuthenticationStatus> {
  return authenticationStatusSchema.parse(await sendApiRequest('POST', '/api/auth/login', { loginId, password }));
}

/** ログアウトする（issue #11）。 */
export async function logOut(): Promise<void> {
  await sendApiRequest('POST', '/api/auth/logout');
}
