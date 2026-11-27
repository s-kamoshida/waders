/**
 * ステータスの自動遷移とアーカイブの判定。
 *
 * 所属: ドメイン層
 * 責務: 現在時刻（日本時間の暦）から、商品のステータスの自動遷移・アーカイブ・リストに戻すときのステータスを決める
 * （要件「ステータスの遷移」「アーカイブ」、機能設計書 BR-01〜BR-05・BR-38）。
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
 *  - 購入済・未購入・キャンセル: 変えない（キャンセルは自動遷移の対象外。issue #57、BR-38）
 * @returns 変える場合は遷移の結果、変えない場合は null
 */
export function determineAutomaticTransition(
  product: Pick<Product, 'status' | 'releaseMonth' | 'orderDeadline'>,
  currentTime: Date,
): AutomaticTransition | null {
  const isReleaseMonthPassed = isReleaseMonthBeforeCurrentMonth(product.releaseMonth, currentTime);
  if (product.status === 'reserved') {
    return isReleaseMonthPassed ? { status: 'purchased', awaitsDeliveryConfirmation: true } : null;
  }
  if (product.status !== 'considering') return null;
  if (!isReleaseMonthPassed && !isOrderDeadlinePassed(product, currentTime)) return null;
  return { status: 'unpurchased', awaitsDeliveryConfirmation: false };
}

/** 受注期限を超過した（日本時間の受注期限の翌日 0:00 になった）か。受注期限がなければ false。 */
function isOrderDeadlinePassed(product: Pick<Product, 'orderDeadline'>, currentTime: Date): boolean {
  return product.orderDeadline !== null && product.orderDeadline < formatDateInJapan(currentTime);
}

/**
 * 利用者が手で保存する商品で、検討中なのに受注期限を超過していれば、受注期限を消した商品を返す（issue #60、BR-39）。
 * 受注期限が残っていると、自動遷移ですぐに未購入に戻り、検討中にできないため。それ以外は渡した商品をそのまま返す。
 * 登録・編集・ステータスの変更・リストに戻すなど、利用者の操作で保存する直前に使う（自動遷移では使わない）。
 */
export function clearPassedOrderDeadlineOfConsidering<T extends Pick<Product, 'status' | 'orderDeadline'>>(product: T, currentTime: Date): T {
  if (product.status !== 'considering' || !isOrderDeadlinePassed(product, currentTime)) return product;
  return { ...product, orderDeadline: null };
}

/** 発売月が当月（日本時間）より前か（発売月を超過したか）。 */
function isReleaseMonthBeforeCurrentMonth(releaseMonth: string, currentTime: Date): boolean {
  return releaseMonth < formatMonthInJapan(currentTime);
}

/**
 * 商品がアーカイブされているか。キャンセルの商品は発売月に関係なくアーカイブとする（issue #57、BR-38）。
 * それ以外は、発売月が当月（日本時間）より前ならステータスにかかわらずアーカイブとする。
 * ステータスを省くと発売月だけで判定する（新しい発売月が当月より前かの判定に使う）。
 */
export function isProductArchived(
  product: Pick<Product, 'releaseMonth'> & { readonly status?: ProductStatus },
  currentTime: Date,
): boolean {
  if (product.status === 'canceled') return true;
  return isReleaseMonthBeforeCurrentMonth(product.releaseMonth, currentTime);
}

/**
 * リストに戻すときのステータスを求める。キャンセルの商品は検討中にする（キャンセルのままでは、すぐにまたアーカイブに移るため。
 * issue #57、BR-38）。それ以外は determineStatusBeforeAutomaticTransition で、自動遷移の前のステータスに戻す。
 * @param history 商品の変更履歴（古い順）
 * @param currentStatus 今のステータス
 */
export function determineRestoredStatus(history: readonly ProductHistoryEntry[], currentStatus: ProductStatus): ProductStatus {
  if (currentStatus === 'canceled') return 'considering';
  return determineStatusBeforeAutomaticTransition(history, currentStatus);
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
