/**
 * 商品と変更履歴の型。
 *
 * 所属: ドメイン層
 * 責務: 商品と、その変更履歴（ステータス・発売月）を表す型を定義する（要件「商品データ」「自動で記録するもの」）。
 * 値の形式と範囲の検証は src/shared/productContract.ts に一本化している。
 */
import type { ProductStatus } from '../../shared/productContract.ts';

/** 商品の ID（UUID）。他の文字列と取り違えないようブランド型にする。 */
export type ProductId = string & { readonly brand: 'ProductId' };

/** 保存されている商品。日時は UTC の ISO 8601 文字列。 */
export type Product = {
  readonly id: ProductId;
  readonly name: string;
  /** 発売月（例: 2026-11）。 */
  readonly releaseMonth: string;
  readonly status: ProductStatus;
  /** 予約を取り消せるか（予約済の商品について）。 */
  readonly cancelable: boolean;
  /** 金額（円・税込）。未入力は null。 */
  readonly price: number | null;
  /** 送料（円・税込）。未入力は null。 */
  readonly shippingFee: number | null;
  /** 受注期限（日本時間の日付。例: 2026-11-20）。未入力は null。 */
  readonly orderDeadline: string | null;
  readonly url: string | null;
  readonly category: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** 変更の種類。利用者の操作か、ステータスの自動遷移か。 */
export type ProductChangeKind = 'user' | 'automatic';

/** 変更履歴を記録する項目。 */
export type ProductHistoryField = 'status' | 'releaseMonth';

/** 変更を記録するための情報。 */
export type ProductChange = {
  readonly changedAt: string;
  readonly changeKind: ProductChangeKind;
};

/**
 * 変更履歴の1件。
 * 登録時はステータスと発売月の初期値を、変更前なし（null）・利用者の操作として記録する。
 */
export type ProductHistoryEntry = {
  readonly changedAt: string;
  readonly changeKind: ProductChangeKind;
  readonly field: ProductHistoryField;
  readonly valueBefore: string | null;
  readonly valueAfter: string;
};

/** 指定した商品が存在しない場合のエラー。 */
export class ProductNotFoundError extends Error {
  constructor(productId: ProductId) {
    super(`商品が見つかりません: ${productId}`);
    this.name = 'ProductNotFoundError';
  }
}

/** アーカイブされていない商品をリストに戻そうとした場合のエラー。 */
export class ProductNotArchivedError extends Error {
  constructor(productId: ProductId) {
    super(`商品はアーカイブされていません: ${productId}`);
    this.name = 'ProductNotArchivedError';
  }
}

/** リストに戻す・延期の確認で指定した新しい発売月が、当月より前の場合のエラー。 */
export class RestoreReleaseMonthInPastError extends Error {
  constructor(releaseMonth: string) {
    super(`新しい発売月が当月より前です: ${releaseMonth}`);
    this.name = 'RestoreReleaseMonthInPastError';
  }
}

/** 延期の確認を待っていない商品に回答した場合のエラー（回答済み・手で購入済にした商品など）。 */
export class DeliveryConfirmationNotPendingError extends Error {
  constructor(productId: ProductId) {
    super(`商品は延期の確認を待っていません: ${productId}`);
    this.name = 'DeliveryConfirmationNotPendingError';
  }
}

/** アーカイブされた商品の発売月を、編集で変えようとした場合のエラー（発売月は「リストに戻す」で変える）。 */
export class ArchivedReleaseMonthChangeError extends Error {
  constructor(productId: ProductId) {
    super(`アーカイブされた商品の発売月は編集で変更できません: ${productId}`);
    this.name = 'ArchivedReleaseMonthChangeError';
  }
}
