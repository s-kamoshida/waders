/**
 * アーカイブされた商品をリストに戻すモーダル（issue #9）。
 *
 * 所属: クライアント（画面の部品）
 * 責務: 新しい発売月（既定は当月。当月以降のみ）を入力させ、商品をリストに戻す。
 * ステータスはサーバーが変更履歴から自動遷移の前に戻す。戻せたら onRestored を呼ぶ。
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { releaseMonthSchema, type ProductResponse } from '../../shared/productContract.ts';
import { ApiRequestError, restoreProduct } from '../productApiClient.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';

/** RestoreDialog の引数。 */
export type RestoreDialogProps = {
  readonly product: ProductResponse;
  /** 日本時間の当月（YYYY-MM）。新しい発売月の既定値と下限。 */
  readonly currentMonth: string;
  readonly onClose: () => void;
  readonly onRestored: (restored: ProductResponse) => void;
};

/**
 * 新しい発売月を確かめ、誤りがあれば文言を返す。
 * 形式は共有の検証ルールで、当月以降かは当月と比べて確かめる（サーバーも同じ判定をする）。
 */
export function validateNewReleaseMonth(releaseMonth: string, currentMonth: string): string | null {
  const parsed = releaseMonthSchema.safeParse(releaseMonth);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? SCREEN_MESSAGES.releaseMonthBeforeCurrentMonth(currentMonth.replace('-', '/'));
  if (releaseMonth < currentMonth) return SCREEN_MESSAGES.releaseMonthBeforeCurrentMonth(currentMonth.replace('-', '/'));
  return null;
}

/** リストに戻すモーダルを描画する。 */
export function RestoreDialog({ product, currentMonth, onClose, onRestored }: RestoreDialogProps) {
  const [releaseMonth, setReleaseMonth] = useState(currentMonth);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const releaseMonthInputRef = useRef<HTMLInputElement>(null);
  const idPrefix = useId();

  useEffect(() => {
    releaseMonthInputRef.current?.focus();
  }, []);

  const submitRestore = async (event: FormEvent) => {
    event.preventDefault();
    const validationError = validateNewReleaseMonth(releaseMonth, currentMonth);
    setFieldError(validationError);
    if (validationError !== null) return;
    setGeneralError(null);
    setIsSubmitting(true);
    try {
      onRestored(await restoreProduct(product.id, releaseMonth));
    } catch (error) {
      const isRejectedByServer = error instanceof ApiRequestError && error.status >= 400 && error.status < 500;
      setGeneralError(isRejectedByServer ? error.message : SCREEN_MESSAGES.restoreFailed);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--small"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idPrefix}-title`}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !isSubmitting) onClose();
        }}
      >
        <form noValidate onSubmit={(event) => void submitRestore(event)}>
          <h2 id={`${idPrefix}-title`} className="dialog-title">
            {SCREEN_MESSAGES.restoreTitle}
          </h2>
          <div className="dialog-body">
            {generalError !== null && (
              <p role="alert" className="dialog-error">
                {generalError}
              </p>
            )}
            <p className="delete-target">{product.name}</p>
            <div className="field">
              <label htmlFor={`${idPrefix}-release-month`}>新しい発売月</label>
              <input
                id={`${idPrefix}-release-month`}
                ref={releaseMonthInputRef}
                type="month"
                min={currentMonth}
                value={releaseMonth}
                aria-invalid={fieldError !== null}
                aria-describedby={fieldError === null ? undefined : `${idPrefix}-release-month-error`}
                onChange={(event) => setReleaseMonth(event.target.value)}
              />
              {fieldError !== null && (
                <span id={`${idPrefix}-release-month-error`} className="field-error">
                  {fieldError}
                </span>
              )}
            </div>
            <p className="hint">{SCREEN_MESSAGES.restoreNote}</p>
          </div>
          <div className="dialog-footer">
            <span className="dialog-footer-spacer" />
            <button type="button" className="button" disabled={isSubmitting} onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" className="button button--primary" disabled={isSubmitting}>
              戻す
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
