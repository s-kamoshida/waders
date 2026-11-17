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
  archiveEmpty: 'アーカイブされた商品はありません',
  archivedReleaseMonthHint: '発売月は「リストに戻す」で変更します。',
  restoreTitle: 'リストに戻す',
  restoreNote: 'ステータスはアーカイブ時に自動で変わる前に戻ります（手で変えたステータスはそのまま）。',
  restoreFailed: 'リストに戻せませんでした。時間をおいて、もう一度お試しください。',
  deliveryConfirmationTitle: '発売月を過ぎた予約商品の確認',
  deliveryConfirmationNote:
    '次の商品は発売月を過ぎたため、購入済にしてアーカイブしました。届いたかどうかを教えてください。回答しなかった商品は次回も表示します。',
  deliveryConfirmationFailed: '回答を保存できませんでした。時間をおいて、もう一度お試しください。',
  /** 新しい発売月が当月より前の場合の文言。currentMonthLabel は「2026/11」の形。 */
  releaseMonthBeforeCurrentMonth: (currentMonthLabel: string) => `発売月は当月（${currentMonthLabel}）以降を指定してください。`,
} as const;
