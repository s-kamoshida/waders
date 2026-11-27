/**
 * 商品の詳細画面（SCR-09。issue #52）。
 *
 * 所属: クライアント（画面の部品）
 * 責務:
 *  - カードを押したときに、編集の前に開く「見るだけ」のモーダル。画像を大きく、編集で入れられる項目をすべて表示する
 *    （カテゴリーで出し入れする項目は編集のモーダルと同じ決まり。値がなければ「－」、読み上げでは「未入力」。issue #63）
 *  - 金額は、最終的な金額と内訳（送料・手数料・交通費（見込）・その他費用・値引き）を表示する（金額が未入力なら「－」）
 *  - ステータスはプルダウンで選ぶと、その場で保存する（PATCH /api/products/:productId/status）。失敗したら元に戻して知らせる
 *  - 右上の閉じるボタン（×）と Esc で閉じる。「削除」（確認を出す）・「編集」、アーカイブの商品では「リストに戻す」
 *  - 購入先は項目のドメイン名のリンクで開く（下の端に「購入先を開く」ボタンは置かない。押し間違えやすいため）
 */
import { useId, useState, type ReactNode } from 'react';
import type { CategoryResponse } from '../../shared/categoryContract.ts';
import type { ProductResponse, ProductStatus, StatusChangeRequest } from '../../shared/productContract.ts';
import { changeProductStatus, deleteProduct, resolveApiPath } from '../productApiClient.ts';
import {
  describeProductAmount,
  determineVisibleCategoryFields,
  extractShopDomain,
  formatFullDate,
  formatJapanDateTimeWithWeekday,
  formatReleaseMonthLabel,
  getStatusLabel,
  resolveOtherExpenseLabel,
} from '../productDisplay.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';

/** ProductDetailDialog の引数。 */
export type ProductDetailDialogProps = {
  readonly product: ProductResponse;
  /** カテゴリーの定義（読めない場合は null）。項目の出し入れと「その他費用」の名前に使う。 */
  readonly categories: readonly CategoryResponse[] | null;
  readonly onClose: () => void;
  /** 「編集」を押した。呼び出し側は詳細画面の代わりに編集のモーダルを開く。 */
  readonly onEditRequested: () => void;
  /** 商品を削除した。 */
  readonly onDeleted: () => void;
  /** ステータスを変えた（新しい商品を渡す）。詳細画面は開いたまま。 */
  readonly onStatusChanged: (updated: ProductResponse) => void;
  /** 「リストに戻す」を押した（アーカイブの商品だけ渡す。渡さなければボタンを出さない）。 */
  readonly onRestoreRequested?: () => void;
};

/** プルダウンの選択肢の値。予約済（キャンセル可）は、ステータスとは別の値で表す。 */
type StatusOptionValue = ProductStatus | 'reservedCancelable';

/** プルダウンの選択肢（検討中・予約済・予約済（キャンセル可）・購入済・未購入・キャンセル（issue #57））。 */
const STATUS_OPTIONS: readonly { readonly value: StatusOptionValue; readonly change: StatusChangeRequest }[] = [
  { value: 'considering', change: { status: 'considering' } },
  { value: 'reserved', change: { status: 'reserved', cancelable: false } },
  { value: 'reservedCancelable', change: { status: 'reserved', cancelable: true } },
  { value: 'purchased', change: { status: 'purchased' } },
  { value: 'unpurchased', change: { status: 'unpurchased' } },
  { value: 'canceled', change: { status: 'canceled' } },
];

/** 商品のステータスに対応する選択肢の値。 */
function selectStatusOptionValue(product: Pick<ProductResponse, 'status' | 'cancelable'>): StatusOptionValue {
  return product.status === 'reserved' && product.cancelable ? 'reservedCancelable' : product.status;
}

/** 選択肢の表示（ステータスの表記と同じ）。 */
function labelStatusOption(change: StatusChangeRequest): string {
  return getStatusLabel(change.status, change.cancelable ?? false);
}

/** ステータスの印のクラス（カードの色と同じ）。 */
function selectStatusBadgeClassName(product: Pick<ProductResponse, 'status' | 'cancelable'>): string {
  const value = selectStatusOptionValue(product);
  return `detail-status detail-status--${value === 'reservedCancelable' ? 'cancelable' : value}`;
}

/** 共通のアイコン（画像がない・読めない場合）。 */
function DetailPlaceholderIcon() {
  return (
    <svg className="detail-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M3 11h18M12 7v13M12 7c-1.5-3-5-3.5-5-1.5S10 7 12 7Zm0 0c1.5-3 5-3.5 5-1.5S14 7 12 7Z" />
    </svg>
  );
}

/**
 * 値がないことを示す印（issue #63）。見た目は全角の「－」だけにし、読み上げでは「未入力」と伝える
 * （「－」だけでは意味が伝わらないため、アクセシブルな名前を付ける）。
 */
function EmptyValueMark({ className }: { readonly className?: string }) {
  return (
    <span className={className === undefined ? 'detail-empty' : `${className} detail-empty`} role="img" aria-label={SCREEN_MESSAGES.detailValueEmptyLabel}>
      {SCREEN_MESSAGES.detailValueEmpty}
    </span>
  );
}

/** 項目の 1 行（値がなければ「－」）。 */
function DetailItem({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const isEmpty = children === null || children === undefined || children === '';
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{isEmpty ? <EmptyValueMark /> : children}</dd>
    </div>
  );
}

/** 日時を表示用にする（空なら null）。 */
function formatOptionalDateTime(utcDateTime: string | null): string | null {
  return utcDateTime === null ? null : formatJapanDateTimeWithWeekday(utcDateTime);
}

/** 詳細画面を描画する。 */
export function ProductDetailDialog({ product, categories, onClose, onEditRequested, onDeleted, onStatusChanged, onRestoreRequested }: ProductDetailDialogProps) {
  const idPrefix = useId();
  /** 表示している商品（ステータスを変えたら新しい商品にする）。 */
  const [shownProduct, setShownProduct] = useState(product);
  /** 保存中の選択肢（保存している間はプルダウンをこの値にする）。 */
  const [pendingStatusValue, setPendingStatusValue] = useState<StatusOptionValue | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 読み込めなかった画像の URL（カードと同じく、URL が変われば読み込み直す）
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  const isBusy = pendingStatusValue !== null || isDeleting;
  const imageUrl = shownProduct.imageUrl !== null && shownProduct.imageUrl !== failedImageUrl ? shownProduct.imageUrl : null;
  const visibleFields = determineVisibleCategoryFields(categories, shownProduct.categoryId, shownProduct);
  const amount = describeProductAmount(shownProduct, resolveOtherExpenseLabel(categories, shownProduct.categoryId));
  const shopDomain = extractShopDomain(shownProduct.url);

  const changeStatus = async (value: StatusOptionValue) => {
    const option = STATUS_OPTIONS.find((candidate) => candidate.value === value);
    if (option === undefined || value === selectStatusOptionValue(shownProduct)) return;
    setStatusError(null);
    setPendingStatusValue(value);
    try {
      const updated = await changeProductStatus(shownProduct.id, option.change);
      setShownProduct(updated);
      onStatusChanged(updated);
    } catch {
      setStatusError(SCREEN_MESSAGES.productStatusChangeFailed);
    } finally {
      setPendingStatusValue(null);
    }
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteProduct(shownProduct.id);
      onDeleted();
    } catch {
      setIsConfirmingDelete(false);
      setDeleteError(SCREEN_MESSAGES.productDeleteFailed);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idPrefix}-title`}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !isBusy && !isConfirmingDelete) onClose();
        }}
      >
        <div className="dialog-header">
          <h2 id={`${idPrefix}-title`} className="dialog-title">
            商品の詳細
          </h2>
          <button type="button" className="dialog-close-button" aria-label="閉じる" disabled={isBusy} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dialog-body detail-body">
          <div className={imageUrl === null ? 'detail-media detail-media--empty' : 'detail-media'}>
            {imageUrl === null ? (
              <DetailPlaceholderIcon />
            ) : (
              <img className="detail-image" src={resolveApiPath(imageUrl)} alt="商品の画像" onError={() => setFailedImageUrl(imageUrl)} />
            )}
          </div>
          {statusError !== null && (
            <p role="alert" className="dialog-error">
              {statusError}
            </p>
          )}
          {deleteError !== null && (
            <p role="alert" className="dialog-error">
              {deleteError}
            </p>
          )}
          <div className="detail-heading">
            <span className={selectStatusBadgeClassName(shownProduct)}>{getStatusLabel(shownProduct.status, shownProduct.cancelable)}</span>
            {shownProduct.maker !== null && <p className="detail-maker">{shownProduct.maker}</p>}
            <h3 className="detail-name">{shownProduct.name}</h3>
          </div>
          <div className="detail-price">
            {amount === null ? (
              <EmptyValueMark className="detail-total" />
            ) : (
              <>
                <span className="detail-total">{amount.total}</span>
                {amount.breakdown !== null && <span className="detail-breakdown">{amount.breakdown}</span>}
              </>
            )}
          </div>
          <div className="detail-status-field">
            <label htmlFor={`${idPrefix}-status`}>ステータス</label>
            <select
              id={`${idPrefix}-status`}
              value={pendingStatusValue ?? selectStatusOptionValue(shownProduct)}
              disabled={isBusy}
              onChange={(event) => void changeStatus(event.target.value as StatusOptionValue)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {labelStatusOption(option.change)}
                </option>
              ))}
            </select>
          </div>
          <dl className="detail-list">
            <DetailItem label="カテゴリー">{shownProduct.categoryName ?? SCREEN_MESSAGES.detailCategoryUnset}</DetailItem>
            <DetailItem label="発売月">{formatReleaseMonthLabel(shownProduct.releaseMonth)}</DetailItem>
            {visibleFields.has('orderDeadline') && (
              <DetailItem label="受注期限">{shownProduct.orderDeadline === null ? null : formatFullDate(shownProduct.orderDeadline)}</DetailItem>
            )}
            {visibleFields.has('eventPeriod') && <DetailItem label="開催日時">{formatOptionalDateTime(shownProduct.eventStartsAt)}</DetailItem>}
            {visibleFields.has('eventPeriod') && <DetailItem label="終了日時">{formatOptionalDateTime(shownProduct.eventEndsAt)}</DetailItem>}
            {visibleFields.has('location') && <DetailItem label="場所">{shownProduct.location}</DetailItem>}
            <DetailItem label="購入先">
              {shopDomain === null || shownProduct.url === null ? null : (
                <a className="detail-link" href={shownProduct.url} target="_blank" rel="noopener noreferrer">
                  {shopDomain}
                </a>
              )}
            </DetailItem>
            <DetailItem label="備考">{shownProduct.note === null ? null : <span className="detail-note">{shownProduct.note}</span>}</DetailItem>
          </dl>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button button--danger" disabled={isBusy} onClick={() => setIsConfirmingDelete(true)}>
            削除
          </button>
          <span className="dialog-footer-spacer" />
          {onRestoreRequested !== undefined && (
            <button type="button" className="button" disabled={isBusy} onClick={onRestoreRequested}>
              リストに戻す
            </button>
          )}
          <button type="button" className="button button--primary" disabled={isBusy} onClick={onEditRequested}>
            編集
          </button>
        </div>
      </div>

      {isConfirmingDelete && (
        <div className="dialog-backdrop">
          <div className="dialog dialog--small" role="alertdialog" aria-modal="true" aria-labelledby={`${idPrefix}-delete-title`}>
            <h2 id={`${idPrefix}-delete-title`} className="dialog-title">
              {SCREEN_MESSAGES.deleteConfirmationTitle}
            </h2>
            <div className="dialog-body">
              <p className="delete-target">{shownProduct.name}</p>
              <p className="hint">{SCREEN_MESSAGES.deleteConfirmationNote}</p>
            </div>
            <div className="dialog-footer">
              <span className="dialog-footer-spacer" />
              <button type="button" className="button" disabled={isDeleting} onClick={() => setIsConfirmingDelete(false)}>
                削除しない
              </button>
              <button type="button" className="button button--danger-filled" disabled={isDeleting} onClick={() => void confirmDelete()}>
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
