/**
 * カテゴリーの型とエラー。
 *
 * 所属: ドメイン層
 * 責務: カテゴリー（ID と名前）と、カテゴリーに関する業務ルールのエラーを定義する（要件「商品カテゴリー」、issue #10）。
 * カテゴリーの定義の正本は、データのフォルダにある JSON ファイル（infrastructure/categoryDefinitionFile.ts）。
 */

/** カテゴリーの ID。定義のファイルに書かれた文字列（1〜100 文字）。名前と取り違えないようブランド型にする。 */
export type CategoryId = string & { readonly brand: 'CategoryId' };

/** カテゴリー。名前は前後の空白を除いた 1〜50 文字で、定義の中で ID・名前は重複しない。 */
export type Category = {
  readonly id: CategoryId;
  readonly name: string;
};

/**
 * カテゴリーの定義のファイルが読めない・形式に誤りがある場合のエラー。
 * メッセージはファイル名と誤りの場所を含み、そのまま利用者に見せてよい（定義を直す手がかりにするため）。
 */
export class CategoryDefinitionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CategoryDefinitionError';
  }
}

/** 商品に指定したカテゴリーが定義にない場合のエラー。 */
export class CategoryNotFoundError extends Error {
  constructor(categoryId: string) {
    super(`カテゴリーが定義にありません: ${categoryId}`);
    this.name = 'CategoryNotFoundError';
  }
}
