/**
 * 認証の操作（アカウントの作成・ログイン・ログアウト・ログインした状態の確認・アカウントの消去）。
 *
 * 所属: アプリケーション層
 * 責務（issue #11）:
 *  - パスワードを scrypt とソルトでハッシュ値にして保存し、比較は timingSafeEqual で行う（平文で保存しない）
 *  - ログインした状態の Cookie の値は乱数で作り、DB には SHA-256 だけを保存する
 *  - ログインの失敗が 5 回続いたら 15 分制限する（総当たり対策）。失敗の記録はメモリに持つ（再起動で数え直す）
 *  - ログインの試行は 1 つずつ順に処理する（同時に送られた試行で、制限の回数をすり抜けさせないため）
 * 現在時刻は Clock から受け取る。
 */
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import {
  AccountAlreadyExistsError,
  AuthenticationDisabledError,
  LoginFailedError,
  LoginLockedError,
  NO_LOGIN_FAILURES,
  SESSION_LIFETIME_MILLISECONDS,
  findLoginLockEnd,
  isSessionExpired,
  recordLoginFailure,
  type LoginFailureRecord,
} from '../domain/account.ts';
import type { AccountRepository } from '../infrastructure/sqliteAccountRepository.ts';
import type { AuthenticationStatus } from '../../shared/authenticationContract.ts';
import type { Clock } from './productService.ts';

/** createAuthenticationService の引数。 */
export type AuthenticationServiceDependencies = {
  readonly accountRepository: AccountRepository;
  readonly clock: Clock;
  /** 認証を有効にするか（設定の authenticationEnabled）。 */
  readonly authenticationEnabled: boolean;
};

/** 認証の操作。token はログインした状態の Cookie の値。 */
export type AuthenticationService = {
  /** 認証が有効かを返す。 */
  isAuthenticationEnabled(): boolean;
  /** 認証の状態を返す。ログインしていれば、最後に使った日時を更新する。 */
  getStatus(token: string | undefined): AuthenticationStatus;
  /**
   * アカウントを作り、ログインした状態にする。
   * @param loginId 前後の空白を除いた ID（形式は検証済み）
   * @param password 形式を検証済みのパスワード
   * @returns ログインした状態の Cookie の値
   * @throws {AccountAlreadyExistsError} すでにアカウントがある場合
   * @throws {AuthenticationDisabledError} 認証が無効な場合
   */
  setUpAccount(loginId: string, password: string): Promise<string>;
  /**
   * ログインする。
   * @returns ログインした状態の Cookie の値
   * @throws {LoginLockedError} 失敗が続いて制限している場合（ID とパスワードが正しくても）
   * @throws {LoginFailedError} ID かパスワードが誤りの場合
   * @throws {AuthenticationDisabledError} 認証が無効な場合
   */
  logIn(loginId: string, password: string): Promise<string>;
  /** ログインした状態を消す。token がない・見つからない場合は何もしない。 */
  logOut(token: string | undefined): void;
  /**
   * ログインした状態が有効かを確かめ、有効なら最後に使った日時を更新する（期間を延ばす）。
   * @returns 有効なら true。期限切れの状態は消して false
   */
  verifySession(token: string | undefined): boolean;
  /** アカウントとすべてのログインした状態を消す（パスワードを忘れた場合。商品などは消さない）。 */
  resetAccount(): void;
};

/** scrypt のパラメーター（N = 2^14、r = 8、p = 1。メモリは約 16MB で、Raspberry Pi でも動く）。 */
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const SESSION_TOKEN_LENGTH = 32;

/** 保存するハッシュ値の形式: scrypt$N$r$p$ソルト（base64）$ハッシュ（base64）。 */
const PASSWORD_HASH_PATTERN = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

/** アカウントがないときに、パスワードの比較と同じだけ時間をかけるためのハッシュ値（どの入力とも一致しない）。 */
const UNMATCHABLE_PASSWORD_HASH = `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${Buffer.alloc(SALT_LENGTH).toString('base64')}$${Buffer.alloc(SCRYPT_KEY_LENGTH).toString('base64')}`;

/** scrypt でハッシュ値を求める。 */
function deriveKey(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, keyLength, options, (error, derivedKey) => {
      if (error === null) resolve(derivedKey);
      else reject(error);
    });
  });
}

/** パスワードを、ソルトとパラメーターを含むハッシュ値の文字列にする。 */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const options = { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION };
  const derivedKey = await deriveKey(password, salt, SCRYPT_KEY_LENGTH, options);
  return ['scrypt', SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION, salt.toString('base64'), derivedKey.toString('base64')].join('$');
}

/** パスワードが保存したハッシュ値と一致するかを、かかる時間が内容によらない方法で比べる。形式の誤ったハッシュ値は一致しない。 */
async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const matched = PASSWORD_HASH_PATTERN.exec(passwordHash);
  if (matched === null) return false;
  const [, cost, blockSize, parallelization, saltText, keyText] = matched;
  const expectedKey = Buffer.from(keyText ?? '', 'base64');
  const options = { N: Number(cost), r: Number(blockSize), p: Number(parallelization) };
  const derivedKey = await deriveKey(password, Buffer.from(saltText ?? '', 'base64'), expectedKey.length, options);
  return expectedKey.length > 0 && timingSafeEqual(derivedKey, expectedKey);
}

/** 文字列を SHA-256 の 16 進数にする。 */
function hashWithSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 2 つの ID が一致するかを、かかる時間が内容によらない方法で比べる。 */
function isSameLoginId(givenLoginId: string, storedLoginId: string): boolean {
  return timingSafeEqual(Buffer.from(hashWithSha256(givenLoginId), 'hex'), Buffer.from(hashWithSha256(storedLoginId), 'hex'));
}

/** 認証の操作を作る。 */
export function createAuthenticationService(dependencies: AuthenticationServiceDependencies): AuthenticationService {
  const { accountRepository, clock, authenticationEnabled } = dependencies;
  let loginFailureRecord: LoginFailureRecord = NO_LOGIN_FAILURES;
  let loginQueue: Promise<unknown> = Promise.resolve();

  /** ログインした状態を作って保存し、Cookie の値を返す。期限切れの状態もここで片付ける。 */
  const startSession = (): string => {
    const currentTime = clock.now();
    const token = randomBytes(SESSION_TOKEN_LENGTH).toString('base64url');
    const expiredBefore = new Date(currentTime.getTime() - SESSION_LIFETIME_MILLISECONDS).toISOString();
    accountRepository.deleteSessionsLastUsedBefore(expiredBefore);
    accountRepository.insertSession({ tokenHash: hashWithSha256(token), createdAt: currentTime.toISOString(), lastUsedAt: currentTime.toISOString() });
    return token;
  };

  const verifySession = (token: string | undefined): boolean => {
    if (token === undefined || token === '') return false;
    const tokenHash = hashWithSha256(token);
    const session = accountRepository.findSession(tokenHash);
    if (session === undefined) return false;
    const currentTime = clock.now();
    if (isSessionExpired(session, currentTime)) {
      accountRepository.deleteSession(tokenHash);
      return false;
    }
    accountRepository.updateSessionLastUsedAt(tokenHash, currentTime.toISOString());
    return true;
  };

  /** ログインを 1 回試みる（loginQueue から 1 つずつ呼ぶ）。 */
  const attemptLogIn = async (loginId: string, password: string): Promise<string> => {
    const lockEnd = findLoginLockEnd(loginFailureRecord, clock.now());
    if (lockEnd !== null) throw new LoginLockedError(lockEnd);
    const account = accountRepository.findAccount();
    // ID が誤りの場合やアカウントがない場合も、パスワードの比較と同じだけ時間をかける（どちらが誤りかを時間から推測させない）
    const passwordMatches = await verifyPassword(password, account?.passwordHash ?? UNMATCHABLE_PASSWORD_HASH);
    const loginIdMatches = account !== undefined && isSameLoginId(loginId.trim(), account.loginId);
    if (!passwordMatches || !loginIdMatches) {
      loginFailureRecord = recordLoginFailure(loginFailureRecord, clock.now());
      throw new LoginFailedError();
    }
    loginFailureRecord = NO_LOGIN_FAILURES;
    return startSession();
  };

  return {
    isAuthenticationEnabled: () => authenticationEnabled,
    getStatus(token) {
      if (!authenticationEnabled) return { authenticationEnabled: false, accountExists: false, loggedIn: false };
      const accountExists = accountRepository.findAccount() !== undefined;
      return { authenticationEnabled: true, accountExists, loggedIn: accountExists && verifySession(token) };
    },
    async setUpAccount(loginId, password) {
      if (!authenticationEnabled) throw new AuthenticationDisabledError();
      if (accountRepository.findAccount() !== undefined) throw new AccountAlreadyExistsError();
      const passwordHash = await hashPassword(password);
      const inserted = accountRepository.insertAccount({ loginId, passwordHash, createdAt: clock.now().toISOString() });
      if (!inserted) throw new AccountAlreadyExistsError();
      return startSession();
    },
    logIn(loginId, password) {
      if (!authenticationEnabled) return Promise.reject(new AuthenticationDisabledError());
      const attempt = loginQueue.then(() => attemptLogIn(loginId, password));
      loginQueue = attempt.catch(() => undefined);
      return attempt;
    },
    logOut(token) {
      if (token === undefined || token === '') return;
      accountRepository.deleteSession(hashWithSha256(token));
    },
    verifySession,
    resetAccount() {
      accountRepository.deleteAccountAndSessions();
      loginFailureRecord = NO_LOGIN_FAILURES;
    },
  };
}
