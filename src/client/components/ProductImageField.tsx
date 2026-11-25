/**
 * 商品の追加・編集のモーダルの、画像の欄（issue #41）。
 *
 * 所属: クライアント（画面の部品）
 * 責務:
 *  - 画像のファイルを選ばせ、縮めた画像をプレビュー（canvas）に表示する。読めないファイルは知らせる
 *  - 編集では、今の画像を表示する（画面を開いているパスの下の API から読む）
 *  - 「画像を消す」で、選んだ画像・今の画像を外す
 * 画像は選んだ時点では送らない。どうするか（imageChoice）をモーダルに伝え、モーダルが商品を保存した後に送る。
 */
import { useEffect, useRef, useState } from 'react';
import { resolveApiPath } from '../productApiClient.ts';
import { drawProductImagePreview, prepareProductImage, type PreparedProductImage } from '../productImagePreparation.ts';
import { SCREEN_MESSAGES } from '../screenMessages.ts';

/** 画像をどうするか。unchanged は触れていない、selected は選んだ画像を付ける、removed は今の画像を消す。 */
export type ProductImageChoice =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'selected'; readonly prepared: PreparedProductImage }
  | { readonly kind: 'removed' };

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
};

/** 選んだ画像のプレビュー（canvas に描く）。 */
function PreparedImagePreview({ prepared }: { readonly prepared: PreparedProductImage }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current !== null) drawProductImagePreview(canvasRef.current, prepared);
  }, [prepared]);

  return <canvas ref={canvasRef} className="product-image-preview" role="img" aria-label="選んだ画像" />;
}

/** 画像の欄を描画する。 */
export function ProductImageField({ inputId, currentImageUrl, choice, onChoiceChange, onPreparingChange }: ProductImageFieldProps) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** 最後に選んだファイルの番号（先に選んだファイルの縮小が後から終わっても、表示を置き換えないため）。 */
  const latestSelectionRef = useRef(0);
  const showsCurrentImage = choice.kind === 'unchanged' && currentImageUrl !== null;

  // 画像を外したとき（「保存して続けて追加」の後を含む）は、選んだファイルを入力欄から消す
  useEffect(() => {
    if (choice.kind !== 'selected' && inputRef.current !== null) inputRef.current.value = '';
  }, [choice.kind]);

  const selectFile = async (file: File | undefined) => {
    if (file === undefined) return;
    latestSelectionRef.current += 1;
    const selection = latestSelectionRef.current;
    setLoadError(null);
    onPreparingChange(true);
    try {
      const prepared = await prepareProductImage(file);
      if (selection === latestSelectionRef.current) onChoiceChange({ kind: 'selected', prepared });
    } catch {
      if (selection !== latestSelectionRef.current) return;
      setLoadError(SCREEN_MESSAGES.productImageLoadFailed);
      if (inputRef.current !== null) inputRef.current.value = '';
    } finally {
      if (selection === latestSelectionRef.current) onPreparingChange(false);
    }
  };

  const removeImage = () => {
    setLoadError(null);
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
        aria-invalid={loadError !== null}
        aria-describedby={loadError === null ? undefined : `${inputId}-error`}
        onChange={(event) => void selectFile(event.target.files?.[0])}
      />
      {loadError !== null && (
        <span id={`${inputId}-error`} className="field-error">
          {loadError}
        </span>
      )}
    </div>
  );
}
