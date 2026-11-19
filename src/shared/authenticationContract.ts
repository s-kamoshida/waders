/**
 * 認証の形式（クライアントとサーバーで共用）。
 *
 * 所属: 共有（src/shared）
 * 責務: ID・パスワードの形式と、認証の API の要求・応答を Zod のスキーマとして定義する（issue #11）。
 */
import { z } from 'zod';

/** ID の最大の文字数（前後の空白を除く）。 */
export const MAXIMUM_LOGIN_ID_LENGTH = 50;

/** パスワードの最小の文字数。 */
export const MINIMUM_PASSWORD_LENGTH = 8;

/** パスワードの最大の文字数（ハッシュ関数に渡す長さを抑える）。 */
export const MAXIMUM_PASSWORD_LENGTH = 128;

/** ID（前後の空白を除いて 1〜50 文字）。 */
export const loginIdSchema = z
  .string()
  .trim()
  .min(1, 'ID を入力してください。')
  .max(MAXIMUM_LOGIN_ID_LENGTH, `ID は${MAXIMUM_LOGIN_ID_LENGTH}文字以内にしてください。`);

/** アカウントを作るときのパスワード（8〜128 文字。空白も文字として扱い、前後の空白も除かない）。 */
export const newPasswordSchema = z
  .string()
  .min(MINIMUM_PASSWORD_LENGTH, `パスワードは${MINIMUM_PASSWORD_LENGTH}文字以上にしてください。`)
  .max(MAXIMUM_PASSWORD_LENGTH, `パスワードは${MAXIMUM_PASSWORD_LENGTH}文字以内にしてください。`);

/** アカウントの作成（POST /api/auth/setup）の本文のスキーマ。 */
export const accountSetupRequestSchema = z.object({ loginId: loginIdSchema, password: newPasswordSchema });

/** アカウントの作成の本文。 */
export type AccountSetupRequest = z.infer<typeof accountSetupRequestSchema>;

/**
 * ログイン（POST /api/auth/login）の本文のスキーマ。
 * 形式の誤りもログインの失敗として扱うため、長さは検証しない（ハッシュ関数に渡す長さだけを抑える）。
 */
export const loginRequestSchema = z.object({
  loginId: z.string().max(1000),
  password: z.string().max(1000),
});

/** ログインの本文。 */
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** 認証の状態（GET /api/auth/status、作成・ログインの応答）のスキーマ。 */
export const authenticationStatusSchema = z.object({
  /** 認証が有効か。 */
  authenticationEnabled: z.boolean(),
  /** アカウントがあるか（認証が無効なときは false）。 */
  accountExists: z.boolean(),
  /** ログインしているか（認証が無効なときは false）。 */
  loggedIn: z.boolean(),
});

/** 認証の状態。 */
export type AuthenticationStatus = z.infer<typeof authenticationStatusSchema>;
