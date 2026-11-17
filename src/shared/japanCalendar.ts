/**
 * 日本時間（Asia/Tokyo）の暦の日付・年月（クライアントとサーバーで共用）。
 *
 * 所属: 共有（src/shared）
 * 責務: UTC の時刻から、日本時間の日付（YYYY-MM-DD）と年月（YYYY-MM）を求める。
 * 発売月・受注期限など日・月単位の判定は、日本時間の暦で行う（CLAUDE.md「時刻・データ」）。
 */

/** 日本時間と UTC の差（日本は夏時間がないため一定）。 */
const JAPAN_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;

/** 日本時間の日付（YYYY-MM-DD）を返す。 */
export function formatDateInJapan(now: Date): string {
  return new Date(now.getTime() + JAPAN_OFFSET_MILLISECONDS).toISOString().slice(0, 10);
}

/** 日本時間の年月（YYYY-MM）を返す。 */
export function formatMonthInJapan(now: Date): string {
  return formatDateInJapan(now).slice(0, 7);
}
