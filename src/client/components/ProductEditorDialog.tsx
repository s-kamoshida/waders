/**
 * 商品の追加・編集・削除のモーダル。
 *
 * 所属: クライアント（画面の部品）
 * 責務:
 *  - 追加（発売月の既定は当月、ステータスの既定は検討中）と編集（保存済みの値を表示）の入力
 *  - 送信前に共有の検証ルールで確かめ、誤りは入力欄の下に表示する。サーバーが返した入力の誤りも同様に表示する
 *  - メーカー（登録済みのメーカーを入力の候補に出す）と複数行の備考を入力できる（issue #18）
 *  - カテゴリーを定義の並び順から選ぶ。定義にないカテゴリーは「名前（定義にない）」で示し、
 *    定義を読めない場合は変更できなくする（issue #10）
 *  - 場所・手数料・交通費（見込）・その他費用（issue #26）と、開催日時・終了日時（日本時間で分まで入力し、UTC で送る。PR #30 のレビュー）を入力できる
 *  - カテゴリーごとに出し入れする項目は、選んでいるカテゴリーで有効な項目と、開いた時点で値が保存されている項目だけを表示し、
 *    表示していない項目は未入力として送る。その他費用はカテゴリーの名前で示す（issue #27）
 *  - 削除は確認のうえで行う（元に戻せない）
 *  - アーカイブされた商品の編集では、発売月を変更できなくし、「リストに戻す」ボタンを表示する（issue #9）
 *  - 追加では、保存ボタンの横のプルダウンで保存の方法（「保存」「保存して続けて追加」）を選べる。選んだ方法はモーダルを
 *    開いている間保つ。「保存して続けて追加」では、保存した後もモーダルを開いたまま次の商品を入力できる（issue #16）
 *  - 画像を選び・差し替え・消せる。画像は商品を保存した後に送る（商品を保存できなければ送らない。issue #41）
 *  - 購入先の URL を貼り付けたとき（すぐ）と、入力して欄を離れたときに、サーバーにカード画像を取ってもらい、画像の欄にプレビューする（issue #51）。
 *    同じ URL では取り直さない（取った結果を覚えておく）。保存済みの URL のまま・空・形の誤りでは取りに行かない。
 *    取りに行っている間に URL を変えた場合は、前の URL の結果を表示しない。取得中・取れなかった場合も保存はできる。
 *    プレビューの画像は保存では送らない（カード画像は保存の後にサーバーが取りに行く。#42）
 *  - 見出しの行の「閉じる」ボタン（×）は「キャンセル」と同じく、確認を出さずに保存せずに閉じる。保存中は押せない（issue #49）
 * 保存・削除に成功したら onSaved を、「保存して続けて追加」で保存したら onSavedAndContinued を呼ぶ。
 * 商品を保存できて画像を保存できなかった場合は、onSaved に { imageSaveFailed: true } を渡す（issue #41）。
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  PRODUCT_STATUSES,
  collectFieldErrors,
  productInputSchema,
  productUrlSchema,
  type CardImagePreviewResponse,
  type ProductResponse,
  type ProductStatus,
} from '../../shared/productContract.ts';
import {
  ApiRequestError,
  createProduct,
  deleteProduct,
  deleteProductImage,
  updateProduct,
  fetchCardImagePreview,
  uploadProductImage,
} from '../productApiClient.ts';
import type { CategoryControlledField, CategoryResponse } from '../../shared/categoryContract.ts';
import {
  convertJapanDateTimeInputToUtc,
  determineVisibleCategoryFields,
  formatUtcAsJapanDateTimeInput,
  getStatusLabel,
  resolveOtherExpenseLabel,
} from '../productDisplay.ts';
import { formatUndefinedCategoryLabel } from '../productList.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';
import { prepareCardImagePreview } from '../productImagePreparation.ts';
import {
  ProductImageField,
  type CardImagePreviewState,
  type ProductImageChoice,
  type ProductImageFieldHandle,
} from './ProductImageField.tsx';

/** モーダルの用途。追加の場合は発売月の既定値を、編集の場合は対象の商品を持つ。 */
export type ProductEditorMode =
  | { readonly kind: 'create'; readonly defaultReleaseMonth: string }
  | { readonly kind: 'edit'; readonly product: ProductResponse };

/** 保存の結果。imageSaveFailed は、商品を保存できて画像を保存できなかった場合に true（issue #41）。 */
export type ProductSavedResult = { readonly imageSaveFailed: boolean };

/** ProductEditorDialog の引数。 */
export type ProductEditorDialogProps = {
  readonly mode: ProductEditorMode;
  readonly onClose: () => void;
  /** 保存・削除に成功したときに呼ぶ。画像を保存できなかった場合だけ、結果を渡す（issue #41）。 */
  readonly onSaved: (result?: ProductSavedResult) => void;
  /**
   * アーカイブされた商品を編集する場合に渡す。「リストに戻す」を押したときに呼ぶ。
   * 渡した場合、発売月は変更できない（発売月は「リストに戻す」で変える）。
   */
  readonly onRestoreRequested?: () => void;
  /**
   * 追加の場合に渡すと、保存ボタンの横に保存の方法のプルダウンを表示する。「保存して続けて追加」で保存したときに呼ぶ（モーダルは閉じない）。
   * 次の入力では、商品名・金額・送料・URL・メーカー・備考・場所・費用・開催日時・終了日時・画像を空に戻し、
   * 発売月・ステータス・キャンセル可・受注期限・カテゴリーを残す。
   */
  readonly onSavedAndContinued?: () => void;
  /** メーカーの入力の候補（登録済みの商品のメーカー。issue #18）。 */
  readonly makerSuggestions?: readonly string[];
  /**
   * 選べるカテゴリー（定義の並び順。issue #10）。定義を読めない場合は null（カテゴリーを変更できなくする）。
   * 省略した場合は、定義のカテゴリーがないものとして扱う。
   */
  readonly categories?: readonly CategoryResponse[] | null;
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
  maker: string;
  note: string;
  /** カテゴリーの ID。未設定は空文字。 */
  categoryId: string;
  location: string;
  handlingFee: string;
  travelExpense: string;
  otherExpense: string;
  /** 開催日時（日本時間の日時の入力欄の値。例: 2026-11-20T18:00）。 */
  eventStartsAt: string;
  /** 終了日時（日本時間の日時の入力欄の値）。 */
  eventEndsAt: string;
};

/** 「保存して続けて追加」で空に戻す項目の値。 */
const CLEARED_FOR_NEXT_PRODUCT = {
  name: '',
  price: '',
  shippingFee: '',
  url: '',
  maker: '',
  note: '',
  location: '',
  handlingFee: '',
  travelExpense: '',
  otherExpense: '',
  eventStartsAt: '',
  eventEndsAt: '',
} as const satisfies Partial<FormValues>;

/** 用途に応じた入力欄の初期値を作る。 */
function createInitialValues(mode: ProductEditorMode): FormValues {
  if (mode.kind === 'create') {
    return { ...CLEARED_FOR_NEXT_PRODUCT, releaseMonth: mode.defaultReleaseMonth, status: 'considering', cancelable: false, orderDeadline: '', categoryId: '' };
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
    maker: product.maker ?? '',
    categoryId: product.categoryId ?? '',
    note: product.note ?? '',
    location: product.location ?? '',
    handlingFee: product.handlingFee === null ? '' : String(product.handlingFee),
    travelExpense: product.travelExpense === null ? '' : String(product.travelExpense),
    otherExpense: product.otherExpense === null ? '' : String(product.otherExpense),
    eventStartsAt: formatUtcAsJapanDateTimeInput(product.eventStartsAt),
    eventEndsAt: formatUtcAsJapanDateTimeInput(product.eventEndsAt),
  };
}

/**
 * 入力欄の値を、送信する入力にする。表示していない項目は未入力（キャンセル可否は不可）にする（issue #27）。
 * @param visibleFields 表示している、出し入れする項目
 */
function convertToProductInput(values: FormValues, visibleFields: ReadonlySet<CategoryControlledField>): Record<string, unknown> {
  const whenVisible = <Value,>(field: CategoryControlledField, value: Value): Value | null => (visibleFields.has(field) ? value : null);
  return {
    name: values.name,
    releaseMonth: values.releaseMonth,
    status: values.status,
    cancelable: visibleFields.has('cancelable') && values.cancelable,
    price: convertToNumberOrNull(values.price),
    shippingFee: whenVisible('shippingFee', convertToNumberOrNull(values.shippingFee)),
    orderDeadline: whenVisible('orderDeadline', convertToTextOrNull(values.orderDeadline)),
    url: convertToTextOrNull(values.url),
    maker: whenVisible('maker', convertToTextOrNull(values.maker)),
    note: convertToTextOrNull(values.note),
    categoryId: values.categoryId === '' ? null : values.categoryId,
    location: whenVisible('location', convertToTextOrNull(values.location)),
    handlingFee: whenVisible('handlingFee', convertToNumberOrNull(values.handlingFee)),
    travelExpense: whenVisible('travelExpense', convertToNumberOrNull(values.travelExpense)),
    otherExpense: whenVisible('otherExpense', convertToNumberOrNull(values.otherExpense)),
    eventStartsAt: whenVisible('eventPeriod', convertJapanDateTimeInputToUtc(values.eventStartsAt)),
    eventEndsAt: whenVisible('eventPeriod', convertJapanDateTimeInputToUtc(values.eventEndsAt)),
  };
}

/**
 * カテゴリーのプルダウンの選択肢を作る。「未設定」と定義の並び順のカテゴリーに加え、
 * 編集する商品のカテゴリーが定義にない（または定義を読めない）場合は、そのカテゴリーも加える。
 */
function buildCategoryOptions(
  categories: readonly CategoryResponse[] | null,
  mode: ProductEditorMode,
): { value: string; label: string }[] {
  const options = [{ value: '', label: '未設定' }, ...(categories ?? []).map((category) => ({ value: category.id, label: category.name }))];
  if (mode.kind !== 'edit' || mode.product.categoryId === null) return options;
  if (options.some((option) => option.value === mode.product.categoryId)) return options;
  const categoryName = mode.product.categoryName ?? mode.product.categoryId;
  options.push({ value: mode.product.categoryId, label: categories === null ? categoryName : formatUndefinedCategoryLabel(categoryName) });
  return options;
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
export function ProductEditorDialog({
  mode,
  onClose,
  onSaved,
  onRestoreRequested,
  onSavedAndContinued,
  makerSuggestions = [],
  categories = [],
}: ProductEditorDialogProps) {
  const [values, setValues] = useState<FormValues>(() => createInitialValues(mode));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [saveMethod, setSaveMethod] = useState<SaveMethod>('save');
  const [isSaveMenuOpen, setIsSaveMenuOpen] = useState(false);
  const [imageChoice, setImageChoice] = useState<ProductImageChoice>({ kind: 'unchanged' });
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [cardImagePreview, setCardImagePreview] = useState<CardImagePreviewState>({ kind: 'none' });
  /** 保存済みの購入先の URL（編集。このままなら取りに行かない。issue #51）。 */
  const savedUrl = mode.kind === 'edit' ? (mode.product.url ?? '') : '';
  /** プレビューの対象の URL（最後に取りに行った・表示を決めた URL。issue #51）。 */
  const previewUrlRef = useRef(savedUrl);
  /** 取ったカード画像（URL ごと。同じ URL では取り直さない。issue #51）。 */
  const cardImageCacheRef = useRef(new Map<string, CardImagePreviewResponse['cardImage']>());
  /** URL の欄に文字を貼り付けた直後か（その後の入力の変化ですぐに取りに行く。issue #51）。 */
  const urlPastedRef = useRef(false);
  /** モーダル全体で貼り付けた画像を画像の欄に渡すための参照（issue #45）。 */
  const imageFieldRef = useRef<ProductImageFieldHandle>(null);
  const saveMenuToggleRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const idPrefix = useId();
  const title = mode.kind === 'create' ? '商品を追加' : '商品を編集';
  const isArchived = mode.kind === 'edit' && onRestoreRequested !== undefined;
  const canChooseSaveMethod = mode.kind === 'create' && onSavedAndContinued !== undefined;
  const selectedCategoryId = values.categoryId === '' ? null : values.categoryId;
  const visibleFields = determineVisibleCategoryFields(categories, selectedCategoryId, mode.kind === 'edit' ? mode.product : undefined);
  const otherExpenseLabel = resolveOtherExpenseLabel(categories, selectedCategoryId);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const updateValue = <FieldName extends keyof FormValues>(fieldName: FieldName, value: FormValues[FieldName]) => {
    setValues((current) => ({ ...current, [fieldName]: value }));
    setSavedNotice(null);
  };

  /** 取ったカード画像を読み込み、その URL がまだプレビューの対象なら表示する（issue #51）。 */
  const showCardImagePreview = async (url: string, cardImage: CardImagePreviewResponse['cardImage']) => {
    if (cardImage === null) {
      setCardImagePreview({ kind: 'failed' });
      return;
    }
    try {
      const prepared = await prepareCardImagePreview(cardImage);
      if (previewUrlRef.current === url) setCardImagePreview({ kind: 'ready', prepared });
    } catch {
      if (previewUrlRef.current === url) setCardImagePreview({ kind: 'failed' });
    }
  };

  /**
   * 購入先の URL のカード画像のプレビューを用意する（issue #51）。前と同じ URL なら何もしない。
   * 空・形の誤り・保存済みの URL ではプレビューを消す。取ったことのある URL は、取り直さずに覚えた結果を使う。
   */
  const requestCardImagePreview = (value: string) => {
    const url = value.trim();
    if (url === previewUrlRef.current) return;
    previewUrlRef.current = url;
    if (url === savedUrl || !productUrlSchema.safeParse(url).success) {
      setCardImagePreview({ kind: 'none' });
      return;
    }
    const cache = cardImageCacheRef.current;
    if (cache.has(url)) {
      void showCardImagePreview(url, cache.get(url) ?? null);
      return;
    }
    setCardImagePreview({ kind: 'fetching' });
    fetchCardImagePreview(url).then(
      (cardImage) => {
        cache.set(url, cardImage);
        if (previewUrlRef.current === url) void showCardImagePreview(url, cardImage);
      },
      () => {
        // 失敗（通信の誤りなど）は覚えない（次に URL を入れたときに取り直せるように）
        if (previewUrlRef.current === url) setCardImagePreview({ kind: 'failed' });
      },
    );
  };

  /** 「保存して続けて追加」で保存した後、次の商品の入力に備える。 */
  const prepareNextProduct = (savedName: string, imageSaveFailed: boolean) => {
    setValues((current) => ({ ...current, ...CLEARED_FOR_NEXT_PRODUCT }));
    setImageChoice({ kind: 'unchanged' });
    setCardImagePreview({ kind: 'none' });
    previewUrlRef.current = '';
    setSavedNotice(
      imageSaveFailed ? SCREEN_MESSAGES.productAddedWithoutImage(savedName) : SCREEN_MESSAGES.productAddedAndContinue(savedName),
    );
    setIsSubmitting(false);
    nameInputRef.current?.focus();
    onSavedAndContinued?.();
  };

  /**
   * 保存した商品に、選んだ画像を送る・今の画像を消す（触れていなければ何もしない。issue #41）。
   * @returns 画像を保存できなかった場合は false
   */
  const saveImageChoice = async (productId: string): Promise<boolean> => {
    try {
      if (imageChoice.kind === 'selected') await uploadProductImage(productId, imageChoice.prepared.data);
      if (imageChoice.kind === 'removed') await deleteProductImage(productId);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * 入力を検証して保存する。
   * @param continuesAdding 「保存して続けて追加」で保存する場合は true（モーダルを閉じない）
   */
  const saveProduct = async (continuesAdding: boolean) => {
    setIsSaveMenuOpen(false);
    setSavedNotice(null);
    const parsed = productInputSchema.safeParse(convertToProductInput(values, visibleFields));
    if (!parsed.success) {
      setFieldErrors(collectFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setGeneralError(null);
    setIsSubmitting(true);
    let savedProductId: string;
    try {
      const saved = mode.kind === 'create' ? await createProduct(parsed.data) : await updateProduct(mode.product.id, parsed.data);
      savedProductId = saved.id;
    } catch (error) {
      const serverFieldErrors = error instanceof ApiRequestError ? error.fieldErrors : {};
      if (Object.keys(serverFieldErrors).length > 0) setFieldErrors(serverFieldErrors);
      else setGeneralError(SCREEN_MESSAGES.productSaveFailed);
      setIsSubmitting(false);
      return;
    }
    const imageSaveFailed = !(await saveImageChoice(savedProductId));
    if (continuesAdding) prepareNextProduct(parsed.data.name, imageSaveFailed);
    else if (imageSaveFailed) onSaved({ imageSaveFailed });
    else onSaved();
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

  /** 円の金額の入力欄（送料・手数料・交通費・その他費用）を描画する。 */
  const renderYenField = (fieldName: 'shippingFee' | 'handlingFee' | 'travelExpense' | 'otherExpense', label: string) => (
    <div className="field">
      <label htmlFor={fieldId(fieldName)}>{label}</label>
      <input
        id={fieldId(fieldName)}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={values[fieldName]}
        aria-invalid={fieldErrors[fieldName] !== undefined}
        aria-describedby={describedBy(fieldName)}
        onChange={(event) => updateValue(fieldName, event.target.value)}
      />
      {renderFieldError(fieldName)}
    </div>
  );

  /** 日本時間の日時（分まで）の入力欄（開催日時・終了日時）を描画する。 */
  const renderDateTimeField = (fieldName: 'eventStartsAt' | 'eventEndsAt', label: string) => (
    <div className="field">
      <label htmlFor={fieldId(fieldName)}>{label}</label>
      <input
        id={fieldId(fieldName)}
        type="datetime-local"
        value={values[fieldName]}
        aria-invalid={fieldErrors[fieldName] !== undefined}
        aria-describedby={describedBy(fieldName)}
        onChange={(event) => updateValue(fieldName, event.target.value)}
      />
      {renderFieldError(fieldName)}
    </div>
  );

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
        onPaste={(event) => {
          // クリップボードに画像があれば、文字の欄に入力位置があっても画像として受け取る（issue #45）
          if (imageFieldRef.current?.selectPastedImage(event.clipboardData) === true) event.preventDefault();
        }}
      >
        <form
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void saveProduct(saveMethod === 'saveAndContinue');
          }}
        >
          <div className="dialog-header">
            <h2 id={`${idPrefix}-title`} className="dialog-title">
              {title}
            </h2>
            <button type="button" className="dialog-close-button" aria-label="閉じる" disabled={isSubmitting} onClick={onClose}>
              ×
            </button>
          </div>
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
            {visibleFields.has('maker') && (
              <div className="field">
                <label htmlFor={fieldId('maker')}>メーカー</label>
                <input
                  id={fieldId('maker')}
                  list={fieldId('maker-suggestions')}
                  autoComplete="off"
                  value={values.maker}
                  aria-invalid={fieldErrors.maker !== undefined}
                  aria-describedby={describedBy('maker')}
                  onChange={(event) => updateValue('maker', event.target.value)}
                />
                <datalist id={fieldId('maker-suggestions')}>
                  {makerSuggestions.map((maker) => (
                    <option key={maker} value={maker} />
                  ))}
                </datalist>
                {renderFieldError('maker')}
              </div>
            )}
            <div className="field">
              <label htmlFor={fieldId('categoryId')}>カテゴリー</label>
              <select
                id={fieldId('categoryId')}
                value={values.categoryId}
                disabled={categories === null}
                aria-invalid={fieldErrors.categoryId !== undefined}
                aria-describedby={describedBy('categoryId') ?? (categories === null ? `${fieldId('categoryId')}-hint` : undefined)}
                onChange={(event) => updateValue('categoryId', event.target.value)}
              >
                {buildCategoryOptions(categories, mode).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {renderFieldError('categoryId')}
              {categories === null && (
                <span id={`${fieldId('categoryId')}-hint`} className="hint">
                  {SCREEN_MESSAGES.categoryUnavailable}
                </span>
              )}
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
            {visibleFields.has('cancelable') && (
              <div className="field-check">
                <input
                  id={fieldId('cancelable')}
                  type="checkbox"
                  checked={values.cancelable}
                  onChange={(event) => updateValue('cancelable', event.target.checked)}
                />
                <label htmlFor={fieldId('cancelable')}>キャンセル可</label>
              </div>
            )}
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
              {visibleFields.has('shippingFee') && renderYenField('shippingFee', '送料（税込）')}
            </div>
            {(visibleFields.has('handlingFee') || visibleFields.has('travelExpense')) && (
              <div className="field-row field-row--keep-columns">
                {visibleFields.has('handlingFee') && renderYenField('handlingFee', '手数料')}
                {visibleFields.has('travelExpense') && renderYenField('travelExpense', '交通費（見込）')}
              </div>
            )}
            {visibleFields.has('otherExpense') && renderYenField('otherExpense', otherExpenseLabel)}
            {visibleFields.has('eventPeriod') && (
              <div className="field-row">
                {renderDateTimeField('eventStartsAt', '開催日時')}
                {renderDateTimeField('eventEndsAt', '終了日時')}
              </div>
            )}
            {visibleFields.has('location') && (
              <div className="field">
                <label htmlFor={fieldId('location')}>場所</label>
                <input
                  id={fieldId('location')}
                  value={values.location}
                  aria-invalid={fieldErrors.location !== undefined}
                  aria-describedby={describedBy('location')}
                  onChange={(event) => updateValue('location', event.target.value)}
                />
                {renderFieldError('location')}
              </div>
            )}
            {visibleFields.has('orderDeadline') && (
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
            )}
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
                onPaste={(event) => {
                  // 文字の貼り付けなら、その後の入力の変化ですぐに取りに行く（画像の貼り付けはモーダルが受け取る）
                  urlPastedRef.current = event.clipboardData.getData('text') !== '';
                }}
                onChange={(event) => {
                  updateValue('url', event.target.value);
                  if (!urlPastedRef.current) return;
                  urlPastedRef.current = false;
                  requestCardImagePreview(event.target.value);
                }}
                onBlur={(event) => requestCardImagePreview(event.target.value)}
              />
              {renderFieldError('url')}
            </div>
            <ProductImageField
              ref={imageFieldRef}
              inputId={fieldId('image')}
              currentImageUrl={mode.kind === 'edit' ? mode.product.imageUrl : null}
              currentImageKind={mode.kind === 'edit' ? mode.product.imageKind : null}
              cardImagePreview={cardImagePreview}
              choice={imageChoice}
              onChoiceChange={(choice) => {
                setImageChoice(choice);
                setSavedNotice(null);
              }}
              onPreparingChange={setIsPreparingImage}
            />
            <div className="field">
              <label htmlFor={fieldId('note')}>備考</label>
              <textarea
                id={fieldId('note')}
                rows={3}
                value={values.note}
                aria-invalid={fieldErrors.note !== undefined}
                aria-describedby={describedBy('note')}
                onChange={(event) => updateValue('note', event.target.value)}
              />
              {renderFieldError('note')}
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
              <button type="submit" className="button button--primary" disabled={isSubmitting || isPreparingImage}>
                保存
              </button>
            )}
            {canChooseSaveMethod && (
              <div className="split-button" onKeyDown={handleSaveMenuKeyDown}>
                <button type="submit" className="button button--primary split-button-main" disabled={isSubmitting || isPreparingImage}>
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
