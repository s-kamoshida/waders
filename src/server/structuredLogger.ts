/**
 * 構造化ログの出力。
 *
 * 所属: 横断的関心事（全層から利用可）
 * 責務: 時刻・レベル・メッセージ・付加情報を1行のJSON（JSON Lines）として標準出力／標準エラーへ出力する。
 */

export type LogLevel = 'info' | 'warn' | 'error';

/** ログに添える付加情報。JSON に変換できる値のみ受け付ける。 */
export type LogAttributes = Record<string, string | number | boolean | null>;

/**
 * 1行のJSONとしてログを出力する。error レベルは標準エラーへ出力する。
 * @param level ログレベル
 * @param message 人が読むためのメッセージ
 * @param attributes リクエストIDなどの付加情報
 */
export function writeStructuredLog(level: LogLevel, message: string, attributes: LogAttributes = {}): void {
  const logLine = JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...attributes });
  if (level === 'error') {
    process.stderr.write(`${logLine}\n`);
    return;
  }
  process.stdout.write(`${logLine}\n`);
}
