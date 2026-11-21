/**
 * カテゴリーの型とエラー。
 *
 * 所属: ドメイン層
 * 責務: カテゴリー（ID と名前）と、カテゴリーに関する業務ルールのエラーを定義する（要件「商品カテゴリー」、issue #10）。
 * カテゴリーの定義の正本は、データのフォルダにある JSON ファイル（infrastructure/categoryDefinitionFile.ts）。
 */
import type { CategoryControlledField } from '../../shared/categoryContract.ts';

/** カテゴリーの ID。定義のファイルに書かれた文字列（1〜100 文字）。名前と取り違えないようブランド型にする。 */
export type CategoryId = string & { readonly brand: 'CategoryId' };

/** カテゴリー。名前は前後の空白を除いた 1〜50 文字で、定義の中で ID・名前は重複しない。 */
export type Category = {
  readonly id: CategoryId;
  readonly name: string;
  /** 有効な入力項目（決まった並び。issue #27）。定義で省略されていれば既定（DEFAULT_ENABLED_FIELDS）。 */
  readonly fields: readonly CategoryControlledField[];
  /** 「その他費用」の名前。定義で省略されていれば「その他費用」（issue #27）。 */
  readonly otherExpenseLabel: string;
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

/** 定義にほかのカテゴリーと同じ名前を付けようとした場合のエラー（追加・改名・定義に戻す。issue #10）。 */
export class CategoryNameDuplicateError extends Error {
  readonly categoryName: string;

  constructor(categoryName: string) {
    super(`カテゴリー名が重複しています: ${categoryName}`);
    this.name = 'CategoryNameDuplicateError';
    this.categoryName = categoryName;
  }
}

/** すでに定義にあるカテゴリーを、定義にないカテゴリーとして扱おうとした場合のエラー（issue #10）。 */
export class CategoryAlreadyDefinedError extends Error {
  constructor(categoryId: string) {
    super(`カテゴリーはすでに定義にあります: ${categoryId}`);
    this.name = 'CategoryAlreadyDefinedError';
  }
}

/** 商品の移す先のカテゴリーが定義にない（または移す元と同じ）場合のエラー（issue #10）。 */
export class CategoryDestinationNotFoundError extends Error {
  constructor(categoryId: string) {
    super(`移す先のカテゴリーが定義にありません: ${categoryId}`);
    this.name = 'CategoryDestinationNotFoundError';
  }
}
