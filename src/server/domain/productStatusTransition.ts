/**
 * ステータスの自動遷移とアーカイブの判定。
 *
 * 所属: ドメイン層
 * 責務: 現在時刻（日本時間の暦）から、商品のステータスの自動遷移・アーカイブ・リストに戻すときのステータスを決める
 * （要件「ステータスの遷移」「アーカイブ」、機能設計書 BR-01〜BR-05）。
 * 現在時刻は引数で受け取り、ここでは new Date() を呼ばない。
 */
import { formatDateInJapan, formatMonthInJapan } from '../../shared/japanCalendar.ts';
import { productStatusSchema, type ProductStatus } from '../../shared/productContract.ts';
import type { Product, ProductHistoryEntry } from './product.ts';

/** 自動遷移の結果。awaitsDeliveryConfirmation は、延期の確認（届いたかどうかの質問）を待つか。 */
export type AutomaticTransition = {
  readonly status: ProductStatus;
  readonly awaitsDeliveryConfirmation: boolean;
};

/**
 * 商品のステータスを自動で変えるかを判定する。
 *  - 予約済: 発売月を超過した（日本時間の翌月 1 日 0:00 になった）ら購入済にし、延期の確認を待つ
 *  - 検討中: 受注期限を超過した（日本時間の翌日 0:00 になった）か、発売月を超過したら未購入にする。延期の確認は待たない
 *  - 購入済・未購入: 変えない
 * @returns 変える場合は遷移の結果、変えない場合は null
 */
export function determineAutomaticTransition(
  product: Pick<Product, 'status' | 'releaseMonth' | 'orderDeadline'>,
  currentTime: Date,
): AutomaticTransition | null {
  const isReleaseMonthPassed = isProductArchived(product, currentTime);
  if (product.status === 'reserved') {
    return isReleaseMonthPassed ? { status: 'purchased', awaitsDeliveryConfirmation: true } : null;
  }
  if (product.status !== 'considering') return null;
  const isOrderDeadlinePassed = product.orderDeadline !== null && product.orderDeadline < formatDateInJapan(currentTime);
  if (!isReleaseMonthPassed && !isOrderDeadlinePassed) return null;
  return { status: 'unpurchased', awaitsDeliveryConfirmation: false };
}

/**
 * 商品がアーカイブされているか。発売月が当月（日本時間）より前なら、ステータスにかかわらずアーカイブとする。
 * 新しい発売月が当月より前かの判定にも使う。
 */
export function isProductArchived(product: Pick<Product, 'releaseMonth'>, currentTime: Date): boolean {
  return product.releaseMonth < formatMonthInJapan(currentTime);
}

/**
 * リストに戻すときのステータスを、変更履歴から求める。
 * 最後のステータスの変更が自動遷移なら、その変更前のステータスに戻す。
 * 最後の変更が利用者の操作（手で購入済にした・延期の確認で「買わなかった」と答えたなど）なら、今のステータスのままにする。
 * @param history 商品の変更履歴（古い順）
 * @param currentStatus 今のステータス
 */
export function determineStatusBeforeAutomaticTransition(
  history: readonly ProductHistoryEntry[],
  currentStatus: ProductStatus,
): ProductStatus {
  const lastStatusChange = history.findLast((entry) => entry.field === 'status');
  if (lastStatusChange?.changeKind !== 'automatic') return currentStatus;
  const parsedStatus = productStatusSchema.safeParse(lastStatusChange.valueBefore);
  return parsedStatus.success ? parsedStatus.data : currentStatus;
}
