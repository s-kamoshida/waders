/**
 * 延期の確認のモーダル（issue #9）。
 *
 * 所属: クライアント（画面の部品）
 * 責務:
 *  - 予約済から自動で購入済になった商品ごとに、「届いた」「延期された」「買わなかった」を選ばせる
 *  - 「延期された」は新しい発売月（既定は当月。当月以降のみ）を入力させる
 *  - 回答した商品だけを送る。回答しなかった商品は確認待ちのまま残り、次に開いたときにまた表示する
 * すべて送れたら onCompleted、「あとで」を押したら送らずに onClose を呼ぶ。
 */
import { useId, useState } from 'react';
import type { DeliveryConfirmationRequest, ProductListItem } from '../../shared/productContract.ts';
import { answerDeliveryConfirmation } from '../productApiClient.ts';
import { getStatusLabel } from '../productDisplay.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';
import { validateNewReleaseMonth } from './RestoreDialog.tsx';

/** 回答の選択肢。 */
type AnswerKind = DeliveryConfirmationRequest['answer'];

const ANSWER_OPTIONS: readonly (readonly [AnswerKind, string])[] = [
  ['arrived', '届いた'],
  ['postponed', '延期された'],
  ['notPurchased', '買わなかった'],
];

/** DeliveryConfirmationDialog の引数。 */
export type DeliveryConfirmationDialogProps = {
  /** 延期の確認を待っている商品。 */
  readonly products: readonly ProductListItem[];
  /** 日本時間の当月（YYYY-MM）。「延期された」の新しい発売月の既定値と下限。 */
  readonly currentMonth: string;
  readonly onClose: () => void;
  readonly onCompleted: () => void;
};

/** 延期の確認のモーダルを描画する。 */
export function DeliveryConfirmationDialog({ products, currentMonth, onClose, onCompleted }: DeliveryConfirmationDialogProps) {
  const [answers, setAnswers] = useState<Readonly<Record<string, AnswerKind>>>({});
  const [newReleaseMonths, setNewReleaseMonths] = useState<Readonly<Record<string, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [sentProductIds, setSentProductIds] = useState<ReadonlySet<string>>(new Set());
  const [hasSendError, setHasSendError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const idPrefix = useId();

  const answeredProducts = products.filter((product) => answers[product.id] !== undefined && !sentProductIds.has(product.id));

  /** 商品の回答を、API に送る形にする。 */
  const buildRequest = (product: ProductListItem, answer: AnswerKind): DeliveryConfirmationRequest => {
    if (answer === 'postponed') return { answer, releaseMonth: newReleaseMonths[product.id] ?? currentMonth };
    return { answer };
  };

  const submitAnswers = async () => {
    const nextFieldErrors: Record<string, string> = {};
    for (const product of answeredProducts) {
      if (answers[product.id] !== 'postponed') continue;
      const validationError = validateNewReleaseMonth(newReleaseMonths[product.id] ?? currentMonth, currentMonth);
      if (validationError !== null) nextFieldErrors[product.id] = validationError;
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) return;

    setHasSendError(false);
    setIsSubmitting(true);
    const nextSentProductIds = new Set(sentProductIds);
    /** 回答を 1 件ずつ送り、送れた商品を記録する。 */
    const sendAnswers = async () => {
      for (const product of answeredProducts) {
        const answer = answers[product.id];
        if (answer === undefined) continue;
        await answerDeliveryConfirmation(product.id, buildRequest(product, answer));
        nextSentProductIds.add(product.id);
      }
    };
    try {
      await sendAnswers();
      onCompleted();
    } catch {
      // 送れた商品は確認待ちでなくなったため、やり直すときは送らない
      setSentProductIds(nextSentProductIds);
      setHasSendError(true);
      setIsSubmitting(false);
    }
  };

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
        <h2 id={`${idPrefix}-title`} className="dialog-title">
          {SCREEN_MESSAGES.deliveryConfirmationTitle}
        </h2>
        <div className="dialog-body">
          {hasSendError && (
            <p role="alert" className="dialog-error">
              {SCREEN_MESSAGES.deliveryConfirmationFailed}
            </p>
          )}
          <p className="hint">{SCREEN_MESSAGES.deliveryConfirmationNote}</p>
          {products.map((product) => {
            const isSent = sentProductIds.has(product.id);
            const answer = answers[product.id];
            const errorId = `${idPrefix}-${product.id}-error`;
            return (
              <div key={product.id} className="confirmation-item">
                <p className="confirmation-item-name">{product.name}</p>
                <p className="hint">
                  発売月 {product.releaseMonth.replace('-', '/')} ・ {getStatusLabel('reserved', product.cancelable)} → 購入済
                </p>
                <div className="segmented" role="radiogroup" aria-label={product.name}>
                  {ANSWER_OPTIONS.map(([value, label]) => (
                    <label key={value} className={answer === value ? 'segmented-option segmented-option--selected' : 'segmented-option'}>
                      <input
                        type="radio"
                        name={`${idPrefix}-${product.id}`}
                        value={value}
                        checked={answer === value}
                        disabled={isSent || isSubmitting}
                        onChange={() => setAnswers((current) => ({ ...current, [product.id]: value }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {answer === 'postponed' && (
                  <div className="field">
                    <input
                      type="month"
                      min={currentMonth}
                      aria-label={`${product.name}の新しい発売月`}
                      value={newReleaseMonths[product.id] ?? currentMonth}
                      disabled={isSent || isSubmitting}
                      aria-invalid={fieldErrors[product.id] !== undefined}
                      aria-describedby={fieldErrors[product.id] === undefined ? undefined : errorId}
                      onChange={(event) => setNewReleaseMonths((current) => ({ ...current, [product.id]: event.target.value }))}
                    />
                    {fieldErrors[product.id] !== undefined && (
                      <span id={errorId} className="field-error">
                        {fieldErrors[product.id]}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="dialog-footer">
          <button type="button" className="button" disabled={isSubmitting} onClick={onClose}>
            あとで
          </button>
          <span className="dialog-footer-spacer" />
          <button
            type="button"
            className="button button--primary"
            disabled={isSubmitting || answeredProducts.length === 0}
            onClick={() => void submitAnswers()}
          >
            回答を保存
          </button>
        </div>
      </div>
    </div>
  );
}
