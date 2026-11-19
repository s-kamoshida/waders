/**
 * Web アプリケーション（API と画面の配信）の組み立て。
 *
 * 所属: プレゼンテーション層
 * 責務:
 *  - すべての応答（API・画面のファイル）へのセキュリティヘッダーの付与
 *  - API のミドルウェアとルーティングの順序（Content-Type の確認 → JSON の解析 → 各 API → 404）
 *  - 状態を変えるリクエストに Content-Type: application/json を必須にする（CSRF 対策）
 *  - ビルド済みの画面の配信（画面の URL には index.html を返す）
 *  - 想定外のエラーを 500 の応答に変え、詳細はログにだけ出す
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { CategoryService } from '../application/categoryService.ts';
import type { ProductService } from '../application/productService.ts';
import { writeStructuredLog } from '../structuredLogger.ts';
import type { ApiErrorResponse } from '../../shared/productContract.ts';
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
 * Web アプリケーションを組み立てる。
 * @param options ビルド済みの画面のフォルダと、商品の操作
 * @returns 待ち受けを開始していない Express のアプリケーション
 */
export function createWebApplication(options: WebApplicationOptions): express.Express {
  const application = express();
  application.disable('x-powered-by');
  application.use(applySecurityHeaders);

  const apiRouter = express.Router();
  apiRouter.use(rejectNonJsonStateChangingRequests, express.json({ limit: '100kb' }));
  apiRouter.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  apiRouter.use('/products', createProductRouter(options.productService));
  apiRouter.use('/categories', createCategoryRouter(options.categoryService));
  apiRouter.use(respondApiNotFound);
  apiRouter.use(handleRequestBodyError);
  application.use('/api', apiRouter);

  if (existsSync(options.clientBuildDirectory)) {
    application.use(express.static(options.clientBuildDirectory));
    // 画面の URL（/archive など）を直接開いた場合も、画面の入り口を返す
    application.get(/^\/(?!api\/).*/, (_request, response) => {
      response.sendFile(join(options.clientBuildDirectory, 'index.html'));
    });
  }

  application.use(handleUnexpectedError);
  return application;
}
