/**
 * 認証のアカウントと、ログインした状態・ログインの制限の決まり。
 *
 * 所属: ドメイン層
 * 責務: アカウント・ログインした状態の型と、期限切れ・ログインの制限（総当たり対策）の判定を定める（issue #11）。
 * 現在時刻は引数 currentTime で受け取る（CLAUDE.md「時刻・データ」）。
 */

/** ログインした状態を保つ期間（最後に使ってから 30 日）。 */
export const SESSION_LIFETIME_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;

/** 続けて失敗するとログインを制限する回数。 */
export const MAXIMUM_CONSECUTIVE_LOGIN_FAILURES = 5;

/** ログインを制限する期間（15 分）。 */
export const LOGIN_LOCK_MILLISECONDS = 15 * 60 * 1000;

/** 保存するアカウント（1 つだけ）。 */
export type Account = {
  /** ID（前後の空白を除いたもの）。 */
  readonly loginId: string;
  /** パスワードのハッシュ値（"scrypt$" で始まり、ソルトとパラメーターを含む）。 */
  readonly passwordHash: string;
  /** 作成した日時（UTC の ISO 8601）。 */
  readonly createdAt: string;
};

/** 保存するログインした状態。Cookie の値そのものは保存しない。 */
export type Session = {
  /** Cookie の値の SHA-256（16 進数 64 文字）。 */
  readonly tokenHash: string;
  /** ログインした日時（UTC の ISO 8601）。 */
  readonly createdAt: string;
  /** 最後に使った日時（UTC の ISO 8601）。 */
  readonly lastUsedAt: string;
};

/** ログインの失敗の記録（総当たり対策）。 */
export type LoginFailureRecord = {
  /** 続けて失敗した回数。 */
  readonly consecutiveFailureCount: number;
  /** この日時までログインを制限する。制限していなければ null。 */
  readonly lockedUntil: Date | null;
};

/** 失敗のないログインの失敗の記録。 */
export const NO_LOGIN_FAILURES: LoginFailureRecord = { consecutiveFailureCount: 0, lockedUntil: null };

/** アカウントがすでにあるのに作ろうとした場合のエラー。 */
export class AccountAlreadyExistsError extends Error {
  constructor() {
    super('アカウントはすでにあります。');
    this.name = 'AccountAlreadyExistsError';
  }
}

/** ID かパスワードが誤りの場合のエラー（どちらが誤りかは持たない）。 */
export class LoginFailedError extends Error {
  constructor() {
    super('ID またはパスワードが違います。');
    this.name = 'LoginFailedError';
  }
}

/** ログインの失敗が続いて制限している場合のエラー。 */
export class LoginLockedError extends Error {
  /** 制限を解く日時。 */
  readonly lockedUntil: Date;

  constructor(lockedUntil: Date) {
    super('ログインの失敗が続いたため、ログインを制限しています。');
    this.name = 'LoginLockedError';
    this.lockedUntil = lockedUntil;
  }
}

/** 認証が無効なのに、アカウントの作成やログインをしようとした場合のエラー。 */
export class AuthenticationDisabledError extends Error {
  constructor() {
    super('認証は無効です。');
    this.name = 'AuthenticationDisabledError';
  }
}

/**
 * ログインした状態が期限切れかを判定する。最後に使ってから 30 日たったら期限切れ。
 * @returns 期限切れなら true
 */
export function isSessionExpired(session: Session, currentTime: Date): boolean {
  return currentTime.getTime() - Date.parse(session.lastUsedAt) >= SESSION_LIFETIME_MILLISECONDS;
}

/**
 * ログインを制限しているかを判定する。
 * @returns 制限していれば、制限を解く日時。していなければ null
 */
export function findLoginLockEnd(record: LoginFailureRecord, currentTime: Date): Date | null {
  if (record.lockedUntil === null) return null;
  return currentTime.getTime() < record.lockedUntil.getTime() ? record.lockedUntil : null;
}

/**
 * ログインの失敗を記録する。制限が解けた後の失敗は 1 回目から数え直す。
 * 5 回続けて失敗したら、その時刻から 15 分制限する。
 * @returns 新しい失敗の記録
 */
export function recordLoginFailure(record: LoginFailureRecord, currentTime: Date): LoginFailureRecord {
  const previousCount = record.lockedUntil === null ? record.consecutiveFailureCount : 0;
  const consecutiveFailureCount = previousCount + 1;
  if (consecutiveFailureCount < MAXIMUM_CONSECUTIVE_LOGIN_FAILURES) return { consecutiveFailureCount, lockedUntil: null };
  return { consecutiveFailureCount, lockedUntil: new Date(currentTime.getTime() + LOGIN_LOCK_MILLISECONDS) };
}
