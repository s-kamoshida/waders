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
  /** 「保存して続けて追加」で保存した場合の文言（issue #16）。 */
  productAddedAndContinue: (productName: string) => `「${productName}」を追加しました。`,
  /** カテゴリーの定義を読み込めなかった場合（サーバーの理由がない場合）（issue #10）。 */
  categoryDefinitionLoadFailed: 'カテゴリーの定義を読み込めませんでした。時間をおいて、ページを読み込み直してください。',
  /** カテゴリーの定義に誤りがある場合の補足。 */
  categoryDefinitionFixHint: 'データのフォルダの categories.json を直してから、ページを読み込み直してください。',
  categoryUnavailable: 'カテゴリーの定義に誤りがあるため、カテゴリーは変更できません。',
  uncategorized: 'カテゴリー未設定',
  categoryFilterClear: '選択を解除（すべて表示）',
  /** 認証（issue #11）。 */
  accountSetupTitle: 'アカウントの作成',
  accountSetupNote: 'Waders を使うためのアカウントを作ります。アカウントは1つだけで、作った ID とパスワードでログインします。',
  loginTitle: 'ログイン',
  passwordMismatch: 'パスワードが一致しません。',
  loginFieldsRequired: 'ID とパスワードを入力してください。',
  authenticationFailed: 'ログインできませんでした。時間をおいて、もう一度お試しください。',
  authenticationStatusLoadFailed: 'サーバーに接続できませんでした。時間をおいて、ページを読み込み直してください。',
  logoutFailed: 'ログアウトできませんでした。時間をおいて、もう一度お試しください。',
  /** カテゴリーの管理（issue #10）。 */
  categoryManagerTitle: 'カテゴリーの管理',
  categoryManagerNote: '変更はすぐにカテゴリーの定義（categories.json）に保存します。名前を変えると、そのカテゴリーの商品も新しい名前になります。',
  categorySaveFailed: 'カテゴリーを保存できませんでした。時間をおいて、もう一度お試しください。',
  /** 商品が使っているカテゴリーを削除する場合の確認。 */
  categoryDeleteConfirmation: (categoryName: string, productCount: number) =>
    `「${categoryName}」は ${productCount} 件の商品が使っています。商品をどうしますか？`,
  undefinedCategoryHeading: '定義にないカテゴリー',
  undefinedCategoryNote: 'カテゴリーの定義にないカテゴリーを使っている商品があります。どうするかを選んでください。',
  /** カテゴリーごとの入力項目の説明（SCR-07。issue #27）。 */
  categoryFieldSettingsNote:
    'チェックした項目を、このカテゴリーの商品の追加・編集で入力できます。チェックを外しても、値が保存されている商品では表示します。',
  /** ドラッグアンドドロップで発売月を移動した（issue #13）。monthLabel は「2027/02」の形。 */
  productMoved: (monthLabel: string) => `発売月を ${monthLabel} に移動しました`,
  /** 移動を元に戻した。 */
  productMoveUndone: (monthLabel: string) => `発売月を ${monthLabel} に戻しました`,
  productMoveFailed: '発売月を移動できませんでした。時間をおいて、もう一度お試しください。',
  undo: '元に戻す',
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
