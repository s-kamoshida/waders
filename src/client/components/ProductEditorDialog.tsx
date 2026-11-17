/**
 * 商品の追加・編集・削除のモーダル。
 *
 * 所属: クライアント（画面の部品）
 * 責務:
 *  - 追加（発売月の既定は当月、ステータスの既定は検討中）と編集（保存済みの値を表示）の入力
 *  - 送信前に共有の検証ルールで確かめ、誤りは入力欄の下に表示する。サーバーが返した入力の誤りも同様に表示する
 *  - 削除は確認のうえで行う（元に戻せない）
 *  - アーカイブされた商品の編集では、発売月を変更できなくし、「リストに戻す」ボタンを表示する（issue #9）
 * 保存・削除に成功したら onSaved を呼ぶ。
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  PRODUCT_STATUSES,
  collectFieldErrors,
  productInputSchema,
  type ProductResponse,
  type ProductStatus,
} from '../../shared/productContract.ts';
import { ApiRequestError, createProduct, deleteProduct, updateProduct } from '../productApiClient.ts';
import { getStatusLabel } from '../productDisplay.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';

/** モーダルの用途。追加の場合は発売月の既定値を、編集の場合は対象の商品を持つ。 */
export type ProductEditorMode =
  | { readonly kind: 'create'; readonly defaultReleaseMonth: string }
  | { readonly kind: 'edit'; readonly product: ProductResponse };

/** ProductEditorDialog の引数。 */
export type ProductEditorDialogProps = {
  readonly mode: ProductEditorMode;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  /**
   * アーカイブされた商品を編集する場合に渡す。「リストに戻す」を押したときに呼ぶ。
   * 渡した場合、発売月は変更できない（発売月は「リストに戻す」で変える）。
   */
  readonly onRestoreRequested?: () => void;
};

/** 入力欄の値（入力中は文字列で持つ）。 */
type FormValues = {
  name: string;
  releaseMonth: string;
  status: ProductStatus;
  cancelable: boolean;
  price: string;
  shippingFee: string;
  orderDeadline: string;
  url: string;
};

/** 用途に応じた入力欄の初期値を作る。 */
function createInitialValues(mode: ProductEditorMode): FormValues {
  if (mode.kind === 'create') {
    return { name: '', releaseMonth: mode.defaultReleaseMonth, status: 'considering', cancelable: false, price: '', shippingFee: '', orderDeadline: '', url: '' };
  }
  const { product } = mode;
  return {
    name: product.name,
    releaseMonth: product.releaseMonth,
    status: product.status,
    cancelable: product.cancelable,
    price: product.price === null ? '' : String(product.price),
    shippingFee: product.shippingFee === null ? '' : String(product.shippingFee),
    orderDeadline: product.orderDeadline ?? '',
    url: product.url ?? '',
  };
}

/** 数値の入力欄の値を、未入力なら null、それ以外は数値にする。 */
function convertToNumberOrNull(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

/** 文字の入力欄の値を、空なら null にする。 */
function convertToTextOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** 商品の追加・編集のモーダルを描画する。 */
export function ProductEditorDialog({ mode, onClose, onSaved, onRestoreRequested }: ProductEditorDialogProps) {
  const [values, setValues] = useState<FormValues>(() => createInitialValues(mode));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const idPrefix = useId();
  const title = mode.kind === 'create' ? '商品を追加' : '商品を編集';
  const isArchived = mode.kind === 'edit' && onRestoreRequested !== undefined;

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const updateValue = <FieldName extends keyof FormValues>(fieldName: FieldName, value: FormValues[FieldName]) => {
    setValues((current) => ({ ...current, [fieldName]: value }));
  };

  const submitProduct = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = productInputSchema.safeParse({
      name: values.name,
      releaseMonth: values.releaseMonth,
      status: values.status,
      cancelable: values.cancelable,
      price: convertToNumberOrNull(values.price),
      shippingFee: convertToNumberOrNull(values.shippingFee),
      orderDeadline: convertToTextOrNull(values.orderDeadline),
      url: convertToTextOrNull(values.url),
      category: mode.kind === 'edit' ? mode.product.category : null,
    });
    if (!parsed.success) {
      setFieldErrors(collectFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setGeneralError(null);
    setIsSubmitting(true);
    try {
      if (mode.kind === 'create') await createProduct(parsed.data);
      else await updateProduct(mode.product.id, parsed.data);
      onSaved();
    } catch (error) {
      const serverFieldErrors = error instanceof ApiRequestError ? error.fieldErrors : {};
      if (Object.keys(serverFieldErrors).length > 0) setFieldErrors(serverFieldErrors);
      else setGeneralError(SCREEN_MESSAGES.productSaveFailed);
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (mode.kind !== 'edit') return;
    setIsSubmitting(true);
    try {
      await deleteProduct(mode.product.id);
      onSaved();
    } catch {
      setIsConfirmingDelete(false);
      setGeneralError(SCREEN_MESSAGES.productDeleteFailed);
      setIsSubmitting(false);
    }
  };

  /** 入力欄の id と、誤りの文言の id を作る。 */
  const fieldId = (fieldName: string) => `${idPrefix}-${fieldName}`;
  const renderFieldError = (fieldName: string) =>
    fieldErrors[fieldName] === undefined ? null : (
      <span id={`${fieldId(fieldName)}-error`} className="field-error">
        {fieldErrors[fieldName]}
      </span>
    );
  const describedBy = (fieldName: string) => (fieldErrors[fieldName] === undefined ? undefined : `${fieldId(fieldName)}-error`);

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idPrefix}-title`}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !isSubmitting) onClose();
        }}
      >
        <form noValidate onSubmit={(event) => void submitProduct(event)}>
          <h2 id={`${idPrefix}-title`} className="dialog-title">
            {title}
          </h2>
          <div className="dialog-body">
            {generalError !== null && (
              <p role="alert" className="dialog-error">
                {generalError}
              </p>
            )}
            <div className="field">
              <label htmlFor={fieldId('name')}>商品名</label>
              <input
                id={fieldId('name')}
                ref={nameInputRef}
                value={values.name}
                aria-invalid={fieldErrors.name !== undefined}
                aria-describedby={describedBy('name')}
                onChange={(event) => updateValue('name', event.target.value)}
              />
              {renderFieldError('name')}
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor={fieldId('releaseMonth')}>発売月</label>
                <input
                  id={fieldId('releaseMonth')}
                  type="month"
                  value={values.releaseMonth}
                  disabled={isArchived}
                  aria-invalid={fieldErrors.releaseMonth !== undefined}
                  aria-describedby={describedBy('releaseMonth')}
                  onChange={(event) => updateValue('releaseMonth', event.target.value)}
                />
                {renderFieldError('releaseMonth')}
                {isArchived && <span className="hint">{SCREEN_MESSAGES.archivedReleaseMonthHint}</span>}
              </div>
              <div className="field">
                <label htmlFor={fieldId('status')}>ステータス</label>
                <select
                  id={fieldId('status')}
                  value={values.status}
                  onChange={(event) => updateValue('status', event.target.value as ProductStatus)}
                >
                  {PRODUCT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {getStatusLabel(status, false)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-check">
              <input
                id={fieldId('cancelable')}
                type="checkbox"
                checked={values.cancelable}
                onChange={(event) => updateValue('cancelable', event.target.checked)}
              />
              <label htmlFor={fieldId('cancelable')}>キャンセル可</label>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor={fieldId('price')}>金額（税込）</label>
                <input
                  id={fieldId('price')}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={values.price}
                  aria-invalid={fieldErrors.price !== undefined}
                  aria-describedby={describedBy('price')}
                  onChange={(event) => updateValue('price', event.target.value)}
                />
                {renderFieldError('price')}
              </div>
              <div className="field">
                <label htmlFor={fieldId('shippingFee')}>送料（税込）</label>
                <input
                  id={fieldId('shippingFee')}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={values.shippingFee}
                  aria-invalid={fieldErrors.shippingFee !== undefined}
                  aria-describedby={describedBy('shippingFee')}
                  onChange={(event) => updateValue('shippingFee', event.target.value)}
                />
                {renderFieldError('shippingFee')}
              </div>
            </div>
            <div className="field">
              <label htmlFor={fieldId('orderDeadline')}>受注期限</label>
              <input
                id={fieldId('orderDeadline')}
                type="date"
                value={values.orderDeadline}
                aria-invalid={fieldErrors.orderDeadline !== undefined}
                aria-describedby={describedBy('orderDeadline')}
                onChange={(event) => updateValue('orderDeadline', event.target.value)}
              />
              {renderFieldError('orderDeadline')}
            </div>
            <div className="field">
              <label htmlFor={fieldId('url')}>購入先の URL</label>
              <input
                id={fieldId('url')}
                type="url"
                inputMode="url"
                placeholder="https://"
                value={values.url}
                aria-invalid={fieldErrors.url !== undefined}
                aria-describedby={describedBy('url')}
                onChange={(event) => updateValue('url', event.target.value)}
              />
              {renderFieldError('url')}
            </div>
          </div>
          <div className="dialog-footer">
            {mode.kind === 'edit' && (
              <button type="button" className="button button--danger" disabled={isSubmitting} onClick={() => setIsConfirmingDelete(true)}>
                削除
              </button>
            )}
            {isArchived && (
              <button type="button" className="button" disabled={isSubmitting} onClick={onRestoreRequested}>
                リストに戻す
              </button>
            )}
            <span className="dialog-footer-spacer" />
            <button type="button" className="button" disabled={isSubmitting} onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" className="button button--primary" disabled={isSubmitting}>
              保存
            </button>
          </div>
        </form>
      </div>
      {isConfirmingDelete && mode.kind === 'edit' && (
        <div className="dialog-backdrop">
          <div className="dialog dialog--small" role="alertdialog" aria-modal="true" aria-labelledby={`${idPrefix}-delete-title`}>
            <h2 id={`${idPrefix}-delete-title`} className="dialog-title">
              {SCREEN_MESSAGES.deleteConfirmationTitle}
            </h2>
            <div className="dialog-body">
              <p className="delete-target">{mode.product.name}</p>
              <p className="hint">{SCREEN_MESSAGES.deleteConfirmationNote}</p>
            </div>
            <div className="dialog-footer">
              <span className="dialog-footer-spacer" />
              <button type="button" className="button" disabled={isSubmitting} onClick={() => setIsConfirmingDelete(false)}>
                削除しない
              </button>
              <button type="button" className="button button--danger-filled" disabled={isSubmitting} onClick={() => void confirmDelete()}>
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
