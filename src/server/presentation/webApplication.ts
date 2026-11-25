/**
 * Web アプリケーション（API と画面の配信）の組み立て。
 *
 * 所属: プレゼンテーション層
 * 責務:
 *  - すべての応答（API・画面のファイル）へのセキュリティヘッダーの付与
 *  - 宛先の名前（Host ヘッダー）と、状態を変えるリクエストの送信元（Origin ヘッダー）の確認（DNS リバインディング対策。issue #35）。
 *    許す名前は IP アドレス・localhost・*.local と、設定の allowedHosts。設定（hostValidationEnabled）で無効にできる
 *  - API のミドルウェアとルーティングの順序（Content-Type の確認 → JSON の解析 → 動作確認・認証 → ログインの確認 → 各 API → 404）
 *  - 状態を変えるリクエストに Content-Type: application/json を必須にする（CSRF 対策）
 *  - 認証が有効なときは、/api/health と /api/auth 以外の API にログインを求める（issue #11）。
 *    画面のファイルは認証なしで配信する（画面がログインの画面を表示するため。データはすべて API から取る）
 *  - ビルド済みの画面の配信（画面の URL には index.html を返す）
 *  - 画面と API を、設定のパス（basePath。既定 /waders）の下に置く。`/` と末尾の `/` がないパスは `<basePath>/` へ転送し、
 *    パスの外のそれ以外の URL は 404 にする（issue #39）
 *  - 想定外のエラーを 500 の応答に変え、詳細はログにだけ出す
 */
import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AuthenticationService } from '../application/authenticationService.ts';
import type { CategoryService } from '../application/categoryService.ts';
import type { ProductService } from '../application/productService.ts';
import { writeStructuredLog } from '../structuredLogger.ts';
import type { ApiErrorResponse } from '../../shared/productContract.ts';
import { createAuthenticationRequirement, createAuthenticationRouter } from './authenticationRouter.ts';
import { createCategoryRouter } from './categoryRouter.ts';
import { createProductRouter } from './productRouter.ts';

/**
 * すべての応答に付けるセキュリティヘッダー。
 * 画面はビルド済みの自サイトのファイルだけで動く（インラインのスクリプト・スタイル、外部の読み込みがない）ため、
 * CSP は自サイト（'self'）以外をすべて禁止する。
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    // 他のサイトの枠（iframe）の中に表示させない（クリックジャッキング対策）
    "frame-ancestors 'none'",
  ].join('; '),
  // CSP の frame-ancestors に対応していない古いブラウザ向けのクリックジャッキング対策
  'X-Frame-Options': 'DENY',
  // Content-Type と異なる種類のファイルとして解釈させない
  'X-Content-Type-Options': 'nosniff',
  // 他のサイトへ移動する際に、このアプリの URL を送らない
  'Referrer-Policy': 'no-referrer',
  // 他のサイトから開かれたウィンドウと、ウィンドウの参照を共有しない
  'Cross-Origin-Opener-Policy': 'same-origin',
  // 他のサイトのページから、このアプリのファイルや API の応答を読み込ませない
  'Cross-Origin-Resource-Policy': 'same-origin',
  // 使わないブラウザの機能を無効にする
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

/** createWebApplication の引数。 */
export type WebApplicationOptions = {
  /** ビルド済みの画面のフォルダ。存在しなければ画面は配信せず、API だけを提供する（開発時は Vite が画面を配信する）。 */
  readonly clientBuildDirectory: string;
  /** 商品の操作。 */
  readonly productService: ProductService;
  /** カテゴリーの操作（issue #10）。 */
  readonly categoryService: CategoryService;
  /** 認証の操作（issue #11）。 */
  readonly authenticationService: AuthenticationService;
  /** Host ヘッダーで、既定のほかに許す名前（小文字。設定の allowedHosts。issue #35）。 */
  readonly allowedHosts: readonly string[];
  /** Host・Origin を確かめるか（設定の hostValidationEnabled。issue #35）。 */
  readonly hostValidationEnabled: boolean;
  /** 画面と API を置くパス（設定の basePath。`""` は `/` の下。末尾に `/` は付かない。issue #39）。 */
  readonly basePath: string;
};

/** 状態を変える HTTP メソッド。 */
const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** エラーの応答を返す。 */
function sendApiError(response: Response, status: number, code: string, message: string): void {
  const body: ApiErrorResponse = { error: { code, message } };
  response.status(status).json(body);
}

/**
 * 状態を変えるリクエストに Content-Type: application/json を必須にするミドルウェア。
 * HTML のフォームなど、ブラウザが事前確認（CORS のプリフライト）なしに他のサイトから送れる形式を拒否する。
 * 本文のないリクエスト（削除など）も対象とする。
 */
function rejectNonJsonStateChangingRequests(request: Request, response: Response, next: NextFunction): void {
  if (!STATE_CHANGING_METHODS.has(request.method)) {
    next();
    return;
  }
  const mediaType = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (mediaType === 'application/json') {
    next();
    return;
  }
  sendApiError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type は application/json にしてください。');
}

/** 本文の JSON の解析に失敗したなど、リクエストそのものの誤りを 4xx にする。それ以外は次のエラー処理へ渡す。 */
function handleRequestBodyError(error: unknown, _request: Request, response: Response, next: NextFunction): void {
  const errorType = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
  if (errorType === 'entity.parse.failed') {
    sendApiError(response, 400, 'INVALID_JSON', 'リクエストの本文を JSON として読めません。');
    return;
  }
  if (errorType === 'entity.too.large') {
    sendApiError(response, 413, 'PAYLOAD_TOO_LARGE', 'リクエストの本文が大きすぎます。');
    return;
  }
  next(error);
}

/**
 * Host ヘッダー（例: raspberrypi.local:8080・[fe80::1]:8080）を URL の規則で解釈する。
 * 戻り値の hostname は小文字の名前、host は「名前:ポート」（既定のポートは省く）。名前として読めない値・ないときは undefined。
 */
function parseHostHeader(hostHeader: string | undefined): URL | undefined {
  if (hostHeader === undefined || hostHeader === '' || /[/?#@\\\s]/.test(hostHeader)) return undefined;
  try {
    return new URL(`http://${hostHeader}`);
  } catch {
    return undefined;
  }
}

/** 既定で許す名前（IP アドレス・localhost・*.local）か、設定で許した名前かを判定する。 */
function isAllowedHostName(hostName: string, allowedHosts: readonly string[]): boolean {
  const bareHostName = hostName.replace(/^\[(.*)\]$/, '$1');
  if (isIP(bareHostName) !== 0) return true;
  if (hostName === 'localhost' || hostName.endsWith('.local')) return true;
  return allowedHosts.includes(hostName);
}

/**
 * 宛先の名前（Host）と、状態を変えるリクエストの送信元（Origin）を確かめるミドルウェアを作る（issue #35）。
 * 攻撃者のドメインの名前解決を Waders の IP アドレスに切り替える DNS リバインディングでは、ブラウザは攻撃者のドメインを Host に付けるため、
 * 許した名前以外を拒否すれば、外部のサイトから API を読み書きされない。Origin は二重の対策として、Host と同じ「名前:ポート」のときだけ通す。
 */
function createHostValidation(allowedHosts: readonly string[]) {
  return function validateHostAndOrigin(request: Request, response: Response, next: NextFunction): void {
    const host = parseHostHeader(request.headers.host);
    if (host === undefined || !isAllowedHostName(host.hostname, allowedHosts)) {
      sendApiError(response, 403, 'HOST_NOT_ALLOWED', 'この名前では接続できません。設定の allowedHosts を確認してください。');
      return;
    }
    const origin = request.headers.origin;
    if (!STATE_CHANGING_METHODS.has(request.method) || origin === undefined) {
      next();
      return;
    }
    if (parseOriginHost(origin) !== host.host) {
      sendApiError(response, 403, 'ORIGIN_NOT_ALLOWED', 'ほかのサイトからの操作は受け付けません。');
      return;
    }
    next();
  };
}

/** Origin ヘッダー（例: http://raspberrypi.local:8080）の「名前:ポート」を小文字で返す。null や読めない値は undefined。 */
function parseOriginHost(origin: string): string | undefined {
  try {
    const originUrl = new URL(origin);
    return originUrl.origin === 'null' ? undefined : originUrl.host;
  } catch {
    return undefined;
  }
}

/** すべての応答にセキュリティヘッダーを付けるミドルウェア。 */
function applySecurityHeaders(_request: Request, response: Response, next: NextFunction): void {
  for (const [headerName, headerValue] of Object.entries(SECURITY_HEADERS)) response.setHeader(headerName, headerValue);
  next();
}

/** 存在しない API に 404 を返す。 */
function respondApiNotFound(_request: Request, response: Response): void {
  sendApiError(response, 404, 'API_NOT_FOUND', '指定された API はありません。');
}

/** 想定外のエラーを 500 にする。詳細は利用者に返さず、ログにだけ出す。 */
function handleUnexpectedError(error: unknown, request: Request, response: Response, _next: NextFunction): void {
  writeStructuredLog('error', '想定外のエラーが発生しました', {
    method: request.method,
    path: request.path,
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  sendApiError(response, 500, 'INTERNAL_ERROR', 'サーバーでエラーが発生しました。');
}

/**
 * 画面と API を置くパスの入り口（`/` と、末尾の `/` がない `<basePath>`）を開いた場合に、`<basePath>/` へ転送するミドルウェアを作る。
 * 設定を変えたときに古い転送がブラウザに残らないよう、一時的な転送（302）にする（issue #39）。
 * @param basePath 画面と API を置くパス（`""` 以外）
 */
function createBasePathRedirect(basePath: string) {
  return function redirectToBasePath(request: Request, response: Response, next: NextFunction): void {
    const isReadingRequest = request.method === 'GET' || request.method === 'HEAD';
    if (!isReadingRequest || (request.path !== '/' && request.path !== basePath)) {
      next();
      return;
    }
    response.redirect(302, `${basePath}/`);
  };
}

/**
 * 画面の入り口（index.html）を返す URL か。API の区切り（`api`）を含む URL には画面を返さない
 * （パスの外の API の URL を画面と取り違えないようにするため。issue #39）。
 */
const CLIENT_PAGE_PATH_PATTERN = /^\/(?!(?:[^/]*\/)*api(?:\/|$)).*/;

/**
 * Web アプリケーションを組み立てる。
 * @param options ビルド済みの画面のフォルダ、商品・カテゴリー・認証の操作、Host・Origin の確認の設定、画面と API を置くパス
 * @returns 待ち受けを開始していない Express のアプリケーション
 */
export function createWebApplication(options: WebApplicationOptions): express.Express {
  const application = express();
  application.disable('x-powered-by');
  application.use(applySecurityHeaders);
  if (options.hostValidationEnabled) application.use(createHostValidation(options.allowedHosts));

  const cookiePath = options.basePath === '' ? '/' : options.basePath;
  if (options.basePath !== '') application.use(createBasePathRedirect(options.basePath));

  const apiRouter = express.Router();
  apiRouter.use(rejectNonJsonStateChangingRequests, express.json({ limit: '100kb' }));
  apiRouter.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  apiRouter.use('/auth', createAuthenticationRouter(options.authenticationService, cookiePath));
  apiRouter.use(createAuthenticationRequirement(options.authenticationService, cookiePath));
  apiRouter.use('/products', createProductRouter(options.productService));
  apiRouter.use('/categories', createCategoryRouter(options.categoryService, options.productService));
  apiRouter.use(respondApiNotFound);
  apiRouter.use(handleRequestBodyError);

  // 画面と API は basePath の下に置く（issue #39）
  const siteRouter = express.Router();
  siteRouter.use('/api', apiRouter);
  if (existsSync(options.clientBuildDirectory)) {
    siteRouter.use(express.static(options.clientBuildDirectory));
    // 画面の URL（/archive など）を直接開いた場合も、画面の入り口を返す
    siteRouter.get(CLIENT_PAGE_PATH_PATTERN, (_request, response) => {
      response.sendFile(join(options.clientBuildDirectory, 'index.html'));
    });
  }
  application.use(options.basePath === '' ? '/' : options.basePath, siteRouter);

  application.use(handleUnexpectedError);
  return application;
}
