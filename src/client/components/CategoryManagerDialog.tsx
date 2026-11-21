/**
 * カテゴリーの管理のモーダル（SCR-07）。
 *
 * 所属: クライアント（画面の部品）
 * 責務（issue #10）:
 *  - 開いたときにカテゴリーの定義と商品を読み込み、定義の並び順でカテゴリーと、使っている商品の数（アーカイブを含む）を表示する
 *  - 追加・改名・削除を、操作ごとにすぐサーバーに送る（まとめて保存するボタンは置かない）。操作の後は読み込み直す
 *  - 商品が使っているカテゴリーの削除は、移す先を選んで「移して削除」／「カテゴリー未設定にして削除」／「やめる」で確認する
 *  - 定義にないカテゴリーの商品があれば、「定義に追加する」「別のカテゴリーに移す」「カテゴリー未設定にする」を選ばせる
 *  - 定義のカテゴリーごとに「入力する項目」を開き、出し入れする項目と「その他費用」の名前を変える（issue #27）。
 *    チェックは押すたびに変えた項目だけをすぐ送り、名前は「費用の名前を変更」か Enter キーで送る（空にすると「その他費用」に戻す）
 *  - 定義に誤りがある場合は理由を表示し、変更の欄を出さない
 *  - 閉じるときに、変更したかどうかを呼び出し元に知らせる（表示中の一覧を読み込み直すため）
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import {
  CATEGORY_CONTROLLED_FIELDS,
  categoryNameSchema,
  otherExpenseLabelSchema,
  type CategoryControlledField,
  type CategoryFieldSettingsChange,
  type CategoryResponse,
} from '../../shared/categoryContract.ts';
import type { ProductListItem } from '../../shared/productContract.ts';
import {
  addCategory,
  addUndefinedCategoryToDefinition,
  ApiRequestError,
  deleteCategory,
  fetchCategories,
  fetchProducts,
  reassignUndefinedCategoryProducts,
  renameCategory,
  updateCategoryFieldSettings,
} from '../productApiClient.ts';
import { formatUndefinedCategoryLabel, summarizeCategoryUsage, type CategoryUsage } from '../productList.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';

/** CategoryManagerDialog の引数。 */
export type CategoryManagerDialogProps = {
  /** 閉じるときに呼ぶ。カテゴリーや商品を変更した場合は true。 */
  readonly onClose: (hasChanged: boolean) => void;
};

/** 操作の失敗を、利用者に見せる文言にする。サーバーが理由を返した場合はそれを、それ以外は MSG-E-008。 */
function describeChangeError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return SCREEN_MESSAGES.categorySaveFailed;
  if (error.code === 'CATEGORY_DEFINITION_INVALID') return `${error.message} ${SCREEN_MESSAGES.categoryDefinitionFixHint}`;
  if (error.status < 400 || error.status >= 500) return SCREEN_MESSAGES.categorySaveFailed;
  return Object.values(error.fieldErrors)[0] ?? error.message;
}

/** 名前を検証する。誤りがあれば文言を、なければ null を返す。 */
function validateCategoryName(name: string): string | null {
  const result = categoryNameSchema.safeParse(name);
  return result.success ? null : (result.error.issues[0]?.message ?? SCREEN_MESSAGES.categorySaveFailed);
}

/** 「その他費用」の名前を検証する。空なら null（「その他費用」に戻す）。誤りがあれば文言を返す。 */
function validateOtherExpenseLabel(label: string): { label: string | null } | { error: string } {
  if (label.trim() === '') return { label: null };
  const result = otherExpenseLabelSchema.safeParse(label);
  return result.success ? { label: result.data } : { error: result.error.issues[0]?.message ?? SCREEN_MESSAGES.categorySaveFailed };
}

/** 出し入れする項目のチェックボックスの表記（CATEGORY_CONTROLLED_FIELDS の並び）。 */
const CATEGORY_FIELD_LABELS: Readonly<Record<CategoryControlledField, string>> = {
  shippingFee: '送料',
  maker: 'メーカー',
  orderDeadline: '受注期限',
  cancelable: 'キャンセル可',
  location: '場所',
  eventPeriod: '開催日時・終了日時',
  handlingFee: '手数料',
  travelExpense: '交通費（見込）',
  otherExpense: 'その他費用',
};

/** 「その他費用」の名前の欄（保存した名前が変わったら、呼び出し側が key を変えて入力を作り直す）。 */
function OtherExpenseLabelEditor({
  savedLabel,
  isSubmitting,
  onSave,
  onInvalidLabel,
}: {
  readonly savedLabel: string;
  readonly isSubmitting: boolean;
  readonly onSave: (label: string | null) => void;
  readonly onInvalidLabel: (message: string) => void;
}) {
  const [draftLabel, setDraftLabel] = useState(savedLabel);
  const hasChanged = draftLabel.trim() !== savedLabel;

  const submitLabel = () => {
    const validated = validateOtherExpenseLabel(draftLabel);
    if ('error' in validated) {
      onInvalidLabel(validated.error);
      return;
    }
    onSave(validated.label);
  };

  return (
    <div className="category-fields-label">
      <input
        type="text"
        aria-label="その他費用の名前"
        className="category-row-name"
        value={draftLabel}
        disabled={isSubmitting}
        onChange={(event) => setDraftLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && hasChanged) submitLabel();
        }}
      />
      <button type="button" className="button" disabled={isSubmitting || !hasChanged} onClick={submitLabel}>
        費用の名前を変更
      </button>
    </div>
  );
}

/** カテゴリーの入力する項目の設定（チェックボックスと「その他費用」の名前。issue #27）。 */
function CategoryFieldSettings({
  category,
  isSubmitting,
  onChange,
  onInvalidLabel,
}: {
  readonly category: CategoryResponse;
  readonly isSubmitting: boolean;
  readonly onChange: (changes: CategoryFieldSettingsChange) => void;
  readonly onInvalidLabel: (message: string) => void;
}) {
  return (
    <div className="category-fields">
      <p className="hint">{SCREEN_MESSAGES.categoryFieldSettingsNote}</p>
      <div className="category-fields-options">
        {CATEGORY_CONTROLLED_FIELDS.map((field) => (
          <label key={field} className="category-fields-option">
            <input
              type="checkbox"
              checked={category.fields.includes(field)}
              disabled={isSubmitting}
              onChange={(event) => onChange({ fields: { [field]: event.target.checked } })}
            />
            {CATEGORY_FIELD_LABELS[field]}
          </label>
        ))}
      </div>
      <OtherExpenseLabelEditor
        key={category.otherExpenseLabel}
        savedLabel={category.otherExpenseLabel}
        isSubmitting={isSubmitting}
        onSave={(label) => onChange({ otherExpenseLabel: label })}
        onInvalidLabel={onInvalidLabel}
      />
    </div>
  );
}

/** 移す先のプルダウン。 */
function DestinationSelect({
  destinations,
  value,
  onChange,
}: {
  readonly destinations: readonly CategoryResponse[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const selectId = useId();
  return (
    <span className="category-destination">
      <label htmlFor={selectId}>移す先</label>
      <select id={selectId} value={value} onChange={(event) => onChange(event.target.value)}>
        {destinations.map((destination) => (
          <option key={destination.id} value={destination.id}>
            {destination.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/** 定義のカテゴリーの行（名前の変更・削除と、削除の確認）。 */
function DefinedCategoryRow({
  category,
  destinations,
  isSubmitting,
  onRename,
  onDelete,
  onInvalidName,
  onChangeFieldSettings,
}: {
  readonly category: CategoryResponse & { readonly productCount: number };
  /** 削除するときの移す先（このカテゴリー以外の定義のカテゴリー）。 */
  readonly destinations: readonly CategoryResponse[];
  readonly isSubmitting: boolean;
  readonly onRename: (name: string) => void;
  readonly onDelete: (moveToCategoryId: string | null) => void;
  readonly onInvalidName: (message: string) => void;
  /** 入力する項目と「その他費用」の名前を変える（issue #27）。 */
  readonly onChangeFieldSettings: (changes: CategoryFieldSettingsChange) => void;
}) {
  const [draftName, setDraftName] = useState(category.name);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isFieldSettingsOpen, setIsFieldSettingsOpen] = useState(false);
  const fieldSettingsId = useId();
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? '');

  const submitRename = () => {
    const validationError = validateCategoryName(draftName);
    if (validationError !== null) {
      onInvalidName(validationError);
      return;
    }
    onRename(draftName);
  };

  const startDelete = () => {
    if (category.productCount === 0) {
      onDelete(null);
      return;
    }
    setIsConfirmingDelete(true);
  };

  return (
    <div role="group" aria-label={category.name} className="category-row">
      <div className="category-row-main">
        <input
          type="text"
          aria-label="カテゴリー名"
          className="category-row-name"
          value={draftName}
          disabled={isSubmitting}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draftName.trim() !== category.name) submitRename();
          }}
        />
        <span className="category-row-count">{`${category.productCount}件`}</span>
        <button type="button" className="button" disabled={isSubmitting || draftName.trim() === category.name} onClick={submitRename}>
          名前を変更
        </button>
        <button type="button" className="button button--danger" disabled={isSubmitting || isConfirmingDelete} onClick={startDelete}>
          削除
        </button>
        <button
          type="button"
          className="button"
          aria-expanded={isFieldSettingsOpen}
          aria-controls={fieldSettingsId}
          onClick={() => setIsFieldSettingsOpen((current) => !current)}
        >
          入力する項目
        </button>
      </div>
      {isFieldSettingsOpen && (
        <div id={fieldSettingsId}>
          <CategoryFieldSettings
            category={category}
            isSubmitting={isSubmitting}
            onChange={onChangeFieldSettings}
            onInvalidLabel={onInvalidName}
          />
        </div>
      )}
      {isConfirmingDelete && (
        <div className="category-confirmation">
          <p>{SCREEN_MESSAGES.categoryDeleteConfirmation(category.name, category.productCount)}</p>
          <div className="category-confirmation-actions">
            {destinations.length > 0 && (
              <>
                <DestinationSelect destinations={destinations} value={destinationId} onChange={setDestinationId} />
                <button type="button" className="button button--danger" disabled={isSubmitting} onClick={() => onDelete(destinationId)}>
                  移して削除
                </button>
              </>
            )}
            <button type="button" className="button button--danger" disabled={isSubmitting} onClick={() => onDelete(null)}>
              カテゴリー未設定にして削除
            </button>
            <button type="button" className="button" disabled={isSubmitting} onClick={() => setIsConfirmingDelete(false)}>
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 定義にないカテゴリーの行（3 つの選択肢）。 */
function UndefinedCategoryRow({
  category,
  destinations,
  isSubmitting,
  onAddToDefinition,
  onReassign,
}: {
  readonly category: CategoryUsage;
  /** 移す先（定義のカテゴリー）。 */
  readonly destinations: readonly CategoryResponse[];
  readonly isSubmitting: boolean;
  readonly onAddToDefinition: () => void;
  readonly onReassign: (moveToCategoryId: string | null) => void;
}) {
  const [isChoosingDestination, setIsChoosingDestination] = useState(false);
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? '');

  return (
    <div role="group" aria-label={formatUndefinedCategoryLabel(category.name)} className="category-row">
      <div className="category-row-main">
        <span className="category-row-name category-row-name--undefined">{`「${category.name}」`}</span>
        <span className="category-row-count">{`${category.productCount}件`}</span>
      </div>
      {isChoosingDestination ? (
        <div className="category-confirmation-actions">
          <DestinationSelect destinations={destinations} value={destinationId} onChange={setDestinationId} />
          <button type="button" className="button button--primary" disabled={isSubmitting} onClick={() => onReassign(destinationId)}>
            移す
          </button>
          <button type="button" className="button" disabled={isSubmitting} onClick={() => setIsChoosingDestination(false)}>
            やめる
          </button>
        </div>
      ) : (
        <div className="category-confirmation-actions">
          <button type="button" className="button" disabled={isSubmitting} onClick={onAddToDefinition}>
            定義に追加する
          </button>
          <button
            type="button"
            className="button"
            disabled={isSubmitting || destinations.length === 0}
            onClick={() => setIsChoosingDestination(true)}
          >
            別のカテゴリーに移す
          </button>
          <button type="button" className="button" disabled={isSubmitting} onClick={() => onReassign(null)}>
            カテゴリー未設定にする
          </button>
        </div>
      )}
    </div>
  );
}

/** カテゴリーの管理のモーダルを描画する。 */
export function CategoryManagerDialog({ onClose }: CategoryManagerDialogProps) {
  const [categories, setCategories] = useState<CategoryResponse[] | null | undefined>(undefined);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [changeErrorMessage, setChangeErrorMessage] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasChanged, setHasChanged] = useState(false);
  const idPrefix = useId();

  /** カテゴリーの定義と商品を読み込む。定義を読めない場合は理由を表示する。 */
  const loadCategoriesAndProducts = useCallback(async () => {
    const [categoryResult, productResult] = await Promise.allSettled([fetchCategories(), fetchProducts()]);
    if (productResult.status === 'fulfilled') setProducts(productResult.value);
    if (categoryResult.status === 'fulfilled') {
      setCategories(categoryResult.value);
      setLoadErrorMessage(productResult.status === 'fulfilled' ? null : SCREEN_MESSAGES.productListLoadFailed);
      return;
    }
    const error = categoryResult.reason;
    setCategories(null);
    setLoadErrorMessage(
      error instanceof ApiRequestError && error.code === 'CATEGORY_DEFINITION_INVALID'
        ? `${error.message} ${SCREEN_MESSAGES.categoryDefinitionFixHint}`
        : SCREEN_MESSAGES.categoryDefinitionLoadFailed,
    );
  }, []);

  useEffect(() => {
    void loadCategoriesAndProducts();
  }, [loadCategoriesAndProducts]);

  /** 変更の操作を送り、成否にかかわらず最新の状態を読み込み直す。 */
  const runChange = async (operation: () => Promise<unknown>): Promise<boolean> => {
    setChangeErrorMessage(null);
    setIsSubmitting(true);
    let isSucceeded = false;
    try {
      await operation();
      setHasChanged(true);
      isSucceeded = true;
    } catch (error) {
      setChangeErrorMessage(describeChangeError(error));
    }
    await loadCategoriesAndProducts();
    setIsSubmitting(false);
    return isSucceeded;
  };

  const submitNewCategory = async (event: FormEvent) => {
    event.preventDefault();
    const validationError = validateCategoryName(newCategoryName);
    if (validationError !== null) {
      setChangeErrorMessage(validationError);
      return;
    }
    if (await runChange(() => addCategory(newCategoryName))) setNewCategoryName('');
  };

  const usage = summarizeCategoryUsage(categories ?? [], products);
  const errorMessages = [changeErrorMessage, loadErrorMessage].filter((message): message is string => message !== null);

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idPrefix}-title`}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !isSubmitting) onClose(hasChanged);
        }}
      >
        <h2 id={`${idPrefix}-title`} className="dialog-title">
          {SCREEN_MESSAGES.categoryManagerTitle}
        </h2>
        <div className="dialog-body">
          {errorMessages.length > 0 && (
            <p role="alert" className="dialog-error">
              {errorMessages.join(' ')}
            </p>
          )}
          {categories != null && (
            <>
              <div className="category-list">
                {usage.definedCategories.map((category) => (
                  <DefinedCategoryRow
                    key={`${category.id}:${category.name}`}
                    category={category}
                    destinations={categories.filter((candidate) => candidate.id !== category.id)}
                    isSubmitting={isSubmitting}
                    onRename={(name) => void runChange(() => renameCategory(category.id, name))}
                    onDelete={(moveToCategoryId) => void runChange(() => deleteCategory(category.id, moveToCategoryId))}
                    onInvalidName={setChangeErrorMessage}
                    onChangeFieldSettings={(changes) => void runChange(() => updateCategoryFieldSettings(category.id, changes))}
                  />
                ))}
              </div>
              <form className="category-add" noValidate onSubmit={(event) => void submitNewCategory(event)}>
                <input
                  type="text"
                  aria-label="新しいカテゴリー"
                  placeholder="新しいカテゴリー"
                  className="category-row-name"
                  value={newCategoryName}
                  disabled={isSubmitting}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                />
                <button type="submit" className="button" disabled={isSubmitting}>
                  追加
                </button>
              </form>
              <p className="hint">{SCREEN_MESSAGES.categoryManagerNote}</p>
              {usage.undefinedCategories.length > 0 && (
                <section className="category-undefined" aria-labelledby={`${idPrefix}-undefined`}>
                  <h3 id={`${idPrefix}-undefined`} className="category-undefined-heading">
                    {SCREEN_MESSAGES.undefinedCategoryHeading}
                  </h3>
                  <p className="hint">{SCREEN_MESSAGES.undefinedCategoryNote}</p>
                  {usage.undefinedCategories.map((category) => (
                    <UndefinedCategoryRow
                      key={category.id}
                      category={category}
                      destinations={categories}
                      isSubmitting={isSubmitting}
                      onAddToDefinition={() => void runChange(() => addUndefinedCategoryToDefinition(category.id))}
                      onReassign={(moveToCategoryId) => void runChange(() => reassignUndefinedCategoryProducts(category.id, moveToCategoryId))}
                    />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
        <div className="dialog-footer">
          <span className="dialog-footer-spacer" />
          <button type="button" className="button" disabled={isSubmitting} onClick={() => onClose(hasChanged)}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
