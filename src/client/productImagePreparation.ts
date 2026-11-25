/**
 * 商品の画像を送る前の準備（issue #41）。
 *
 * 所属: クライアント
 * 責務:
 *  - 選んだ画像を読み込み、長い辺を 800px 以下に縮めて JPEG にし、base64 の文字列にする（スマートフォンの写真をそのまま送らないため）
 *  - 縮めた画像を、モーダルのプレビュー（canvas）に描く
 * CSP で data: と blob: の画像を禁止しているため、プレビューは img ではなく canvas に描く。
 * 透過のある画像は、白の背景に重ねてから JPEG にする。
 */

/** 送る画像の長い辺の上限（px）。 */
export const MAXIMUM_PREPARED_IMAGE_SIDE = 800;

/** JPEG にするときの画質（0〜1）。 */
const JPEG_QUALITY = 0.85;

/** 送る準備ができた画像。 */
export type PreparedProductImage = {
  /** 縮めた JPEG の中身（base64。data: の前置きは付けない）。 */
  readonly data: string;
  readonly width: number;
  readonly height: number;
  /** 縮めた画像を描いた canvas（プレビューに描き写す）。 */
  readonly canvas: HTMLCanvasElement;
};

/**
 * 縦横の比を保って、長い辺を上限以下に縮めた大きさを求める。上限以下の画像は大きくしない。
 * 縮めた辺は整数に丸め、1px より小さくしない。
 */
export function calculatePreparedImageSize(width: number, height: number): { width: number; height: number } {
  const longerSide = Math.max(width, height);
  if (longerSide <= MAXIMUM_PREPARED_IMAGE_SIDE) return { width, height };
  const scale = MAXIMUM_PREPARED_IMAGE_SIDE / longerSide;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** canvas の 2D の描画の文脈を返す。使えなければ例外にする。 */
function getDrawingContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('画像を描けません');
  return context;
}

/**
 * 選んだ画像を縮めて JPEG にする。
 * @throws {Error} 画像として読めないファイルの場合
 */
export async function prepareProductImage(file: File): Promise<PreparedProductImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const size = calculatePreparedImageSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = getDrawingContext(canvas);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), width: size.width, height: size.height, canvas };
  } finally {
    bitmap.close();
  }
}

/** 縮めた画像を、プレビューの canvas に描き写す。 */
export function drawProductImagePreview(canvas: HTMLCanvasElement, prepared: PreparedProductImage): void {
  canvas.width = prepared.width;
  canvas.height = prepared.height;
  getDrawingContext(canvas).drawImage(prepared.canvas, 0, 0);
}
