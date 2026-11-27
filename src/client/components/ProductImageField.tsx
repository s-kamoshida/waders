/**
 * 商品の追加・編集のモーダルの、画像の欄（issue #41）。
 *
 * 所属: クライアント（画面の部品）
 * 責務:
 *  - 画像のファイルを選ばせ、縮めた画像をプレビュー（canvas）に表示する。読めないファイルは知らせる
 *  - 編集では、今の画像を表示する（画面を開いているパスの下の API から読む）
 *  - 「画像を消す」で、選んだ画像・今の画像を外す
 *  - クリップボードの画像を貼り付けさせる（issue #45）。iPhone 向けに、長押しで「ペースト」できる貼り付け欄を置く。
 *    モーダル全体での貼り付けは、モーダルが selectPastedImage を呼ぶ
 * 画像は選んだ時点では送らない。どうするか（imageChoice）をモーダルに伝え、モーダルが商品を保存した後に送る。
 */
import { useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type Ref } from 'react';
import { resolveApiPath } from '../productApiClient.ts';
import { drawProductImagePreview, prepareProductImage, type PreparedProductImage } from '../productImagePreparation.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';

/** 画像をどうするか。unchanged は触れていない、selected は選んだ画像を付ける、removed は今の画像を消す。 */
export type ProductImageChoice =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'selected'; readonly prepared: PreparedProductImage }
  | { readonly kind: 'removed' };

/** モーダルから画像の欄を操作するための参照（issue #45）。 */
export type ProductImageFieldHandle = {
  /**
   * 貼り付けの中身に画像があれば、ファイルを選んだときと同じく縮めてプレビューにする。
   * @returns 画像があって受け取った場合は true（呼び出し側は既定の動作を止める）。画像がなければ何もせず false
   */
  selectPastedImage(clipboardData: DataTransfer | null): boolean;
};

/**
 * 貼り付けの中身から、最初の画像のファイルを探す（issue #45）。
 * ブラウザにより items と files のどちらかにしか入らないことがあるため、両方を見る。
 * @returns 画像のファイル。なければ undefined
 */
export function findPastedImageFile(clipboardData: DataTransfer | null): File | undefined {
  if (clipboardData === null) return undefined;
  const fromItems = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .find((file): file is File => file !== null);
  if (fromItems !== undefined) return fromItems;
  return Array.from(clipboardData.files ?? []).find((file) => file.type.startsWith('image/'));
}

/** ProductImageField の引数。 */
export type ProductImageFieldProps = {
  /** ファイルを選ぶ入力欄の id（ラベルと結び付ける）。 */
  readonly inputId: string;
  /** 今の画像の URL（API のパス）。追加や、画像がない商品では null。 */
  readonly currentImageUrl: string | null;
  readonly choice: ProductImageChoice;
  readonly onChoiceChange: (choice: ProductImageChoice) => void;
  /** 選んだ画像を縮めている間は true を知らせる（その間は保存させない）。 */
  readonly onPreparingChange: (isPreparing: boolean) => void;
  /** モーダルから貼り付けた画像を渡すための参照（issue #45）。 */
  readonly ref?: Ref<ProductImageFieldHandle>;
};

/** 選んだ画像のプレビュー（canvas に描く）。 */
function PreparedImagePreview({ prepared }: { readonly prepared: PreparedProductImage }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current !== null) drawProductImagePreview(canvasRef.current, prepared);
  }, [prepared]);

  return <canvas ref={canvasRef} className="product-image-preview" role="img" aria-label="選んだ画像" />;
}

/** 画像をどこから受け取ったか（誤りの印をどちらの欄に付けるかに使う）。file はファイルの選択、paste は貼り付け。 */
type ImageSource = 'file' | 'paste';

/** 画像の欄の下に出す文言と、誤りの印を付ける欄。 */
type ImageError = { readonly message: string; readonly source: ImageSource };

/** 画像の欄を描画する。 */
export function ProductImageField({ inputId, currentImageUrl, choice, onChoiceChange, onPreparingChange, ref }: ProductImageFieldProps) {
  /** 画像の欄の下に出す文言（読めない画像・クリップボードに画像がない）。 */
  const [imageError, setImageError] = useState<ImageError | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** 最後に選んだファイルの番号（先に選んだファイルの縮小が後から終わっても、表示を置き換えないため）。 */
  const latestSelectionRef = useRef(0);
  const showsCurrentImage = choice.kind === 'unchanged' && currentImageUrl !== null;

  // 画像を外したとき（「保存して続けて追加」の後を含む）は、選んだファイルを入力欄から消す
  useEffect(() => {
    if (choice.kind !== 'selected' && inputRef.current !== null) inputRef.current.value = '';
  }, [choice.kind]);

  const selectFile = async (file: File | undefined, source: ImageSource) => {
    if (file === undefined) return;
    latestSelectionRef.current += 1;
    const selection = latestSelectionRef.current;
    setImageError(null);
    onPreparingChange(true);
    try {
      const prepared = await prepareProductImage(file);
      if (selection === latestSelectionRef.current) onChoiceChange({ kind: 'selected', prepared });
    } catch {
      if (selection !== latestSelectionRef.current) return;
      setImageError({ message: SCREEN_MESSAGES.productImageLoadFailed, source });
      if (inputRef.current !== null) inputRef.current.value = '';
    } finally {
      if (selection === latestSelectionRef.current) onPreparingChange(false);
    }
  };

  /** 貼り付けた画像を受け取る。選んであったファイルは入力欄から消す（どちらを使うか紛らわしくしないため）。 */
  const selectPastedImage = (clipboardData: DataTransfer | null): boolean => {
    const file = findPastedImageFile(clipboardData);
    if (file === undefined) return false;
    if (inputRef.current !== null) inputRef.current.value = '';
    void selectFile(file, 'paste');
    return true;
  };

  useImperativeHandle(ref, () => ({ selectPastedImage }));

  /** 貼り付け欄への貼り付け。文字は入れず、画像がなければ知らせる（モーダルの貼り付けの処理には渡さない）。 */
  const pasteIntoPasteArea = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectPastedImage(event.clipboardData)) setImageError({ message: SCREEN_MESSAGES.productImageClipboardEmpty, source: 'paste' });
  };

  const removeImage = () => {
    setImageError(null);
    onChoiceChange(currentImageUrl === null ? { kind: 'unchanged' } : { kind: 'removed' });
  };

  return (
    <div className="field">
      <label htmlFor={inputId}>画像</label>
      {choice.kind === 'selected' && <PreparedImagePreview prepared={choice.prepared} />}
      {showsCurrentImage && currentImageUrl !== null && (
        <img className="product-image-preview" src={resolveApiPath(currentImageUrl)} alt="今の画像" />
      )}
      {(choice.kind === 'selected' || showsCurrentImage) && (
        <button type="button" className="button product-image-remove" onClick={removeImage}>
          画像を消す
        </button>
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        aria-invalid={imageError?.source === 'file'}
        aria-describedby={imageError?.source === 'file' ? `${inputId}-error` : undefined}
        onChange={(event) => void selectFile(event.target.files?.[0], 'file')}
      />
      <div
        className="product-image-paste-area"
        role="textbox"
        aria-label="画像の貼り付け欄"
        aria-invalid={imageError?.source === 'paste'}
        aria-describedby={imageError?.source === 'paste' ? `${inputId}-error` : undefined}
        contentEditable
        suppressContentEditableWarning
        inputMode="none"
        tabIndex={0}
        data-placeholder="ここに画像を貼り付け（長押しして「ペースト」、または Ctrl/⌘+V）"
        onPaste={pasteIntoPasteArea}
        onBeforeInput={(event) => event.preventDefault()}
        onDrop={(event) => event.preventDefault()}
      />
      {imageError !== null && (
        <span id={`${inputId}-error`} className="field-error">
          {imageError.message}
        </span>
      )}
    </div>
  );
}
