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

/**
 * fetch をスタブに置き換える。登録されていないルートには 404 を返す。
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
    const handler = routeHandlers[`${method} ${path}`];
    const stubResponse: StubResponse =
      handler === undefined ? { status: 404, body: { error: { code: 'ROUTE_NOT_FOUND', message: 'not found' } } } : handler(body);
    const status = stubResponse.status ?? 200;
    if (stubResponse.body === undefined) return new Response(null, { status });
    return new Response(JSON.stringify(stubResponse.body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, fetchMock };
}
