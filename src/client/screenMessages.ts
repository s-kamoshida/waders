/**
 * 画面に表示する文言（入力の検証の文言は src/shared/productContract.ts）。
 *
 * 所属: クライアント
 * 責務: 利用者に見える文言を一か所にまとめる。画面設計書のメッセージ一覧と一致させる。
 */
export const SCREEN_MESSAGES = {
  productListLoadFailed: '商品の一覧を読み込めませんでした。時間をおいて、ページを読み込み直してください。',
  productSaveFailed: '保存できませんでした。時間をおいて、もう一度お試しください。',
  productDeleteFailed: '削除できませんでした。時間をおいて、もう一度お試しください。',
  emptyMonth: '商品はありません',
  deleteConfirmationTitle: '商品を削除しますか？',
  deleteConfirmationNote: '削除した商品は元に戻せません。',
} as const;
