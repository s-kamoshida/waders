/**
 * 認証のアカウントとログインした状態の保存（SQLite）。
 *
 * 所属: インフラストラクチャ層
 * 責務: アカウント（1 つだけ）とログインした状態の読み書き（issue #11）。
 * 表は商品と同じ DB にあり、スキーマの移行は sqliteProductRepository.ts の SCHEMA_MIGRATIONS（版数 5）で作る。
 */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Account, Session } from '../domain/account.ts';

/** アカウントとログインした状態の保存の操作。 */
export type AccountRepository = {
  /** アカウントを返す。なければ undefined。 */
  findAccount(): Account | undefined;
  /**
   * アカウントを保存する。
   * @returns 保存した場合は true、すでにアカウントがある場合は false
   */
  insertAccount(account: Account): boolean;
  /** アカウントとすべてのログインした状態を消す（パスワードを忘れた場合の再設定）。 */
  deleteAccountAndSessions(): void;
  /** ログインした状態を保存する。 */
  insertSession(session: Session): void;
  /** Cookie の値のハッシュでログインした状態を返す。なければ undefined。 */
  findSession(tokenHash: string): Session | undefined;
  /** ログインした状態の最後に使った日時を更新する。 */
  updateSessionLastUsedAt(tokenHash: string, lastUsedAt: string): void;
  /** ログインした状態を消す。なければ何もしない。 */
  deleteSession(tokenHash: string): void;
  /** 最後に使った日時が指定より前のログインした状態を消す（期限切れの後片付け）。 */
  deleteSessionsLastUsedBefore(lastUsedAt: string): void;
};

const accountRowSchema = z.object({ login_id: z.string(), password_hash: z.string(), created_at: z.string() });
const sessionRowSchema = z.object({ token_hash: z.string(), created_at: z.string(), last_used_at: z.string() });

/**
 * SQLite の DB を使うアカウントの保存を作る。
 * @param database openProductDatabase で開き、最新の版数に移行した DB
 */
export function createSqliteAccountRepository(database: DatabaseSync): AccountRepository {
  return {
    findAccount() {
      const row = database.prepare('SELECT login_id, password_hash, created_at FROM account WHERE id = 1').get();
      if (row === undefined) return undefined;
      const parsed = accountRowSchema.parse(row);
      return { loginId: parsed.login_id, passwordHash: parsed.password_hash, createdAt: parsed.created_at };
    },
    insertAccount(account) {
      const result = database
        .prepare('INSERT INTO account (id, login_id, password_hash, created_at) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO NOTHING')
        .run(account.loginId, account.passwordHash, account.createdAt);
      return result.changes === 1;
    },
    deleteAccountAndSessions() {
      database.exec('BEGIN');
      try {
        database.exec('DELETE FROM sessions; DELETE FROM account;');
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    insertSession(session) {
      database
        .prepare('INSERT INTO sessions (token_hash, created_at, last_used_at) VALUES (?, ?, ?)')
        .run(session.tokenHash, session.createdAt, session.lastUsedAt);
    },
    findSession(tokenHash) {
      const row = database.prepare('SELECT token_hash, created_at, last_used_at FROM sessions WHERE token_hash = ?').get(tokenHash);
      if (row === undefined) return undefined;
      const parsed = sessionRowSchema.parse(row);
      return { tokenHash: parsed.token_hash, createdAt: parsed.created_at, lastUsedAt: parsed.last_used_at };
    },
    updateSessionLastUsedAt(tokenHash, lastUsedAt) {
      database.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').run(lastUsedAt, tokenHash);
    },
    deleteSession(tokenHash) {
      database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },
    deleteSessionsLastUsedBefore(lastUsedAt) {
      database.prepare('DELETE FROM sessions WHERE last_used_at < ?').run(lastUsedAt);
    },
  };
}
