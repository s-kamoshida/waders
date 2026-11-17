/**
 * 商品の追加・編集・削除のモーダル。
 *
 * 所属: クライアント（画面の部品）
 * 責務:
 *  - 追加（発売月の既定は当月、ステータスの既定は検討中）と編集（保存済みの値を表示）の入力
 *  - 送信前に共有の検証ルールで確かめ、誤りは入力欄の下に表示する。サーバーが返した入力の誤りも同様に表示する
 *  - 削除は確認のうえで行う（元に戻せない）
 *  - アーカイブされた商品の編集では、発売月を変更できなくし、「リストに戻す」ボタンを表示する（issue #9）
 *  - 追加では、保存ボタンの横のプルダウンで保存の方法（「保存」「保存して続けて追加」）を選べる。選んだ方法はモーダルを
 *    開いている間保つ。「保存して続けて追加」では、保存した後もモーダルを開いたまま次の商品を入力できる（issue #16）
 * 保存・削除に成功したら onSaved を、「保存して続けて追加」で保存したら onSavedAndContinued を呼ぶ。
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
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
  /**
   * 追加の場合に渡すと、保存ボタンの横に保存の方法のプルダウンを表示する。「保存して続けて追加」で保存したときに呼ぶ（モーダルは閉じない）。
   * 次の入力では、商品名・金額・送料・URL を空に戻し、発売月・ステータス・キャンセル可・受注期限を残す。
   */
  readonly onSavedAndContinued?: () => void;
};

/** 保存の方法。save は保存して閉じる、saveAndContinue は保存して続けて追加する。 */
type SaveMethod = 'save' | 'saveAndContinue';

const SAVE_METHOD_LABELS: Readonly<Record<SaveMethod, string>> = {
  save: '保存',
  saveAndContinue: '保存して続けて追加',
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
export function ProductEditorDialog({ mode, onClose, onSaved, onRestoreRequested, onSavedAndContinued }: ProductEditorDialogProps) {
  const [values, setValues] = useState<FormValues>(() => createInitialValues(mode));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [saveMethod, setSaveMethod] = useState<SaveMethod>('save');
  const [isSaveMenuOpen, setIsSaveMenuOpen] = useState(false);
  const saveMenuToggleRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const idPrefix = useId();
  const title = mode.kind === 'create' ? '商品を追加' : '商品を編集';
  const isArchived = mode.kind === 'edit' && onRestoreRequested !== undefined;
  const canChooseSaveMethod = mode.kind === 'create' && onSavedAndContinued !== undefined;

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const updateValue = <FieldName extends keyof FormValues>(fieldName: FieldName, value: FormValues[FieldName]) => {
    setValues((current) => ({ ...current, [fieldName]: value }));
    setSavedNotice(null);
  };

  /** 「保存して続けて追加」で保存した後、次の商品の入力に備える。 */
  const prepareNextProduct = (savedName: string) => {
    setValues((current) => ({ ...current, name: '', price: '', shippingFee: '', url: '' }));
    setSavedNotice(SCREEN_MESSAGES.productAddedAndContinue(savedName));
    setIsSubmitting(false);
    nameInputRef.current?.focus();
    onSavedAndContinued?.();
  };

  /**
   * 入力を検証して保存する。
   * @param continuesAdding 「保存して続けて追加」で保存する場合は true（モーダルを閉じない）
   */
  const saveProduct = async (continuesAdding: boolean) => {
    setIsSaveMenuOpen(false);
    setSavedNotice(null);
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
      if (continuesAdding) prepareNextProduct(parsed.data.name);
      else onSaved();
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

  /** 保存の方法を選び、プルダウンを閉じる（保存はしない）。 */
  const chooseSaveMethod = (nextSaveMethod: SaveMethod) => {
    setSaveMethod(nextSaveMethod);
    setIsSaveMenuOpen(false);
    saveMenuToggleRef.current?.focus();
  };

  /** プルダウンのキーボード操作。Esc はプルダウンだけを閉じ（モーダルは閉じない）、上下の矢印で項目を移る。 */
  const handleSaveMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isSaveMenuOpen) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      setIsSaveMenuOpen(false);
      saveMenuToggleRef.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items.at((currentIndex + step) % items.length)?.focus();
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
        <form
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void saveProduct(saveMethod === 'saveAndContinue');
          }}
        >
          <h2 id={`${idPrefix}-title`} className="dialog-title">
            {title}
          </h2>
          <div className="dialog-body">
            {generalError !== null && (
              <p role="alert" className="dialog-error">
                {generalError}
              </p>
            )}
            {savedNotice !== null && (
              <p role="status" className="dialog-notice">
                {savedNotice}
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
            <div className="field-row field-row--keep-columns">
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
            {!canChooseSaveMethod && (
              <button type="submit" className="button button--primary" disabled={isSubmitting}>
                保存
              </button>
            )}
            {canChooseSaveMethod && (
              <div className="split-button" onKeyDown={handleSaveMenuKeyDown}>
                <button type="submit" className="button button--primary split-button-main" disabled={isSubmitting}>
                  {SAVE_METHOD_LABELS[saveMethod]}
                </button>
                <button
                  ref={saveMenuToggleRef}
                  type="button"
                  className="button button--primary split-button-toggle"
                  aria-label="保存方法を選ぶ"
                  aria-haspopup="menu"
                  aria-expanded={isSaveMenuOpen}
                  aria-controls={`${idPrefix}-save-menu`}
                  disabled={isSubmitting}
                  onClick={() => setIsSaveMenuOpen((current) => !current)}
                >
                  <span className="split-button-caret" aria-hidden="true" />
                </button>
                {isSaveMenuOpen && (
                  <>
                    <div className="split-button-overlay" aria-hidden="true" onClick={() => setIsSaveMenuOpen(false)} />
                    <div id={`${idPrefix}-save-menu`} className="split-button-menu" role="menu" aria-label="保存の方法">
                      {(Object.keys(SAVE_METHOD_LABELS) as SaveMethod[]).map((method) => (
                        <button
                          key={method}
                          type="button"
                          role="menuitemradio"
                          aria-checked={saveMethod === method}
                          className="split-button-item"
                          autoFocus={saveMethod === method}
                          onClick={() => chooseSaveMethod(method)}
                        >
                          {SAVE_METHOD_LABELS[method]}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
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
