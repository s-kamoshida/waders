/**
 * 認証の API（/api/auth）と、ほかの API に認証を求めるミドルウェア。
 *
 * 所属: プレゼンテーション層
 * 責務（issue #11・#36）:
 *  - GET  /api/auth/status  認証の状態（{ authenticationEnabled, accountExists, loggedIn }）。ログインしていなくても使える
 *  - POST /api/auth/setup   アカウントの作成（{ loginId, password }）。201 と状態、ログインした状態の Cookie
 *  - POST /api/auth/login   ログイン（{ loginId, password }）。200 と状態、Cookie。誤りは 401（どちらが誤りかを示さない）、制限中は 429。
 *    失敗の回数は TCP の接続元（request.socket.remoteAddress）ごとに数える。X-Forwarded-For は偽装できるため使わない（issue #36）
 *  - POST /api/auth/logout  ログアウト。204 と、Cookie の消去
 *  - 認証が有効なときは、/api/auth と /api/health 以外の API にログインを求める（ない・期限切れは 401）。
 *    使うたびに Cookie の有効期間（30 日）を付け直す
 * Cookie は HttpOnly・SameSite=Strict。Path は画面と API を置くパス（`/` の下なら `/`。issue #39）。HTTPS の仕組みがないため Secure は付けない（README に注意を書く）。
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AuthenticationService } from '../application/authenticationService.ts';
import {
  AccountAlreadyExistsError,
  AuthenticationDisabledError,
  LoginFailedError,
  LoginLockedError,
  SESSION_LIFETIME_MILLISECONDS,
} from '../domain/account.ts';
import { accountSetupRequestSchema, loginRequestSchema } from '../../shared/authenticationContract.ts';
import { collectFieldErrors, type ApiErrorResponse } from '../../shared/productContract.ts';

/** ログインした状態の Cookie の名前。 */
export const SESSION_COOKIE_NAME = 'waders_session';

/** Cookie に付ける属性（Path は画面と API を置くパスで決める）。 */
function createSessionCookieOptions(cookiePath: string) {
  return { httpOnly: true, sameSite: 'strict', path: cookiePath } as const;
}

/** エラーの応答を返す。 */
function sendError(response: Response, status: number, error: ApiErrorResponse['error']): void {
  const body: ApiErrorResponse = { error };
  response.status(status).json(body);
}

/** 要求の Cookie から、ログインした状態の Cookie の値を取り出す。なければ undefined。 */
function readSessionToken(request: Request): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (cookieHeader === undefined) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0 || part.slice(0, separatorIndex).trim() !== SESSION_COOKIE_NAME) continue;
    return part.slice(separatorIndex + 1).trim();
  }
  return undefined;
}

/** ログインした状態の Cookie を付ける（有効期間は 30 日）。 */
function setSessionCookie(response: Response, token: string, cookiePath: string): void {
  response.cookie(SESSION_COOKIE_NAME, token, { ...createSessionCookieOptions(cookiePath), maxAge: SESSION_LIFETIME_MILLISECONDS });
}

/** ログインした状態の Cookie を消す。 */
function clearSessionCookie(response: Response, cookiePath: string): void {
  response.cookie(SESSION_COOKIE_NAME, '', { ...createSessionCookieOptions(cookiePath), maxAge: 0 });
}

/** 認証の操作のエラーを応答にする。想定外のエラーはそのまま投げる（500 の処理へ）。 */
function sendAuthenticationError(response: Response, error: unknown): void {
  if (error instanceof LoginFailedError) {
    sendError(response, 401, { code: 'LOGIN_FAILED', message: 'ID またはパスワードが違います。' });
    return;
  }
  if (error instanceof LoginLockedError) {
    sendError(response, 429, {
      code: 'LOGIN_LOCKED',
      message: 'ログインの失敗が続いたため、15分間ログインできません。時間をおいてやり直してください。',
    });
    return;
  }
  if (error instanceof AccountAlreadyExistsError) {
    sendError(response, 409, { code: 'ACCOUNT_ALREADY_EXISTS', message: 'アカウントはすでにあります。ページを読み込み直してください。' });
    return;
  }
  if (error instanceof AuthenticationDisabledError) {
    sendError(response, 404, { code: 'AUTHENTICATION_DISABLED', message: '認証は無効です。' });
    return;
  }
  throw error;
}

/**
 * 認証の API のルーターを作る。
 * @param authenticationService 認証の操作
 * @param cookiePath Cookie の Path（画面と API を置くパス。`/` の下なら `/`。issue #39）
 */
export function createAuthenticationRouter(authenticationService: AuthenticationService, cookiePath: string): express.Router {
  const router = express.Router();

  router.get('/status', (request, response) => {
    response.json(authenticationService.getStatus(readSessionToken(request)));
  });

  router.post('/setup', async (request, response) => {
    const parsed = accountSetupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, { code: 'VALIDATION_ERROR', message: '入力に誤りがあります。', fieldErrors: collectFieldErrors(parsed.error) });
      return;
    }
    try {
      const token = await authenticationService.setUpAccount(parsed.data.loginId, parsed.data.password);
      setSessionCookie(response, token, cookiePath);
      response.status(201).json({ authenticationEnabled: true, accountExists: true, loggedIn: true });
    } catch (error) {
      sendAuthenticationError(response, error);
    }
  });

  router.post('/login', async (request, response) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, { code: 'VALIDATION_ERROR', message: '入力に誤りがあります。', fieldErrors: collectFieldErrors(parsed.error) });
      return;
    }
    try {
      // TCP の接続元を使う（リバースプロキシを使わないため、X-Forwarded-For や trust proxy の値は信じない）
      const token = await authenticationService.logIn(parsed.data.loginId, parsed.data.password, request.socket.remoteAddress);
      setSessionCookie(response, token, cookiePath);
      response.json({ authenticationEnabled: true, accountExists: true, loggedIn: true });
    } catch (error) {
      sendAuthenticationError(response, error);
    }
  });

  router.post('/logout', (request, response) => {
    authenticationService.logOut(readSessionToken(request));
    clearSessionCookie(response, cookiePath);
    response.status(204).end();
  });

  return router;
}

/**
 * 認証が有効なとき、ログインを求めるミドルウェアを作る。認証が無効なら何もしない。
 * ログインしていれば Cookie の有効期間を付け直して次へ進み、していなければ 401 を返す。
 * @param authenticationService 認証の操作
 * @param cookiePath 付け直す Cookie の Path（createAuthenticationRouter と同じ値。issue #39）
 */
export function createAuthenticationRequirement(authenticationService: AuthenticationService, cookiePath: string) {
  return function requireAuthentication(request: Request, response: Response, next: NextFunction): void {
    if (!authenticationService.isAuthenticationEnabled()) {
      next();
      return;
    }
    const token = readSessionToken(request);
    if (token === undefined || !authenticationService.verifySession(token)) {
      sendError(response, 401, { code: 'AUTHENTICATION_REQUIRED', message: 'ログインしてください。' });
      return;
    }
    setSessionCookie(response, token, cookiePath);
    next();
  };
}
