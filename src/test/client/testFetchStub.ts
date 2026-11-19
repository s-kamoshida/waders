/**
 * 画面テスト用の fetch のスタブ（テスト専用）。
 * 「メソッド + パス」ごとに応答を返す関数を登録し、グローバルの fetch を置き換える。
 */
import { vi, type Mock } from 'vitest';

/** スタブが返す応答。status を省略すると 200。body が undefined なら本文なし。 */
export type StubResponse = { readonly status?: number; readonly body?: unknown };

/** キーは `GET /api/products` の形式。値はリクエストの本文（JSON 解析済み）を受け取り応答を返す関数。 */
export type StubRouteHandlers = Record<string, (requestBody: unknown) => StubResponse>;

/** 記録されたリクエスト。 */
export type RecordedRequest = {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly contentType: string | null;
};

/** スタブが既定で返すカテゴリーの定義（GET /api/categories。issue #10）。 */
export const STUB_CATEGORIES = [
  { id: 'scale', name: 'スケールフィギュア' },
  { id: 'action', name: '可動フィギュア' },
] as const;

/** スタブが既定で返す認証の状態（GET /api/auth/status。認証は無効。issue #11）。 */
export const STUB_AUTHENTICATION_DISABLED = { authenticationEnabled: false, accountExists: false, loggedIn: false } as const;

/** どのテストでも登録されているルート。テストで同じルートを登録した場合は、テストのものを使う。 */
const DEFAULT_ROUTE_HANDLERS: StubRouteHandlers = {
  'GET /api/categories': () => ({ body: { categories: STUB_CATEGORIES } }),
  'GET /api/auth/status': () => ({ body: STUB_AUTHENTICATION_DISABLED }),
};

/**
 * fetch をスタブに置き換える。登録されていないルートには 404 を返す。
 * GET /api/categories は、登録しなくても STUB_CATEGORIES を返す。
 * GET /api/auth/status は、登録しなくても認証が無効であることを返す（issue #11）。
 * @returns 記録されたリクエストの一覧（呼び出し順）と、fetch のモック
 */
export function stubFetchRoutes(routeHandlers: StubRouteHandlers): { requests: RecordedRequest[]; fetchMock: Mock } {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(input);
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const contentType = new Headers(init?.headers).get('Content-Type');
    requests.push({ method, path, body, contentType });
    const handler = routeHandlers[`${method} ${path}`] ?? DEFAULT_ROUTE_HANDLERS[`${method} ${path}`];
    const stubResponse: StubResponse =
      handler === undefined ? { status: 404, body: { error: { code: 'ROUTE_NOT_FOUND', message: 'not found' } } } : handler(body);
    const status = stubResponse.status ?? 200;
    if (stubResponse.body === undefined) return new Response(null, { status });
    return new Response(JSON.stringify(stubResponse.body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, fetchMock };
}
