/**
 * 商品の画像の形式と大きさの決まり（issue #41）。
 *
 * 所属: ドメイン層
 * 責務: 画像の形式を、拡張子や送られた Content-Type ではなく中身の先頭の印（マジックバイト）で判定する。
 * 受け付ける形式は JPEG・PNG・WebP だけとする（SVG のようにスクリプトを含められる形式を受け付けないため）。
 */

/** 受け付ける画像の形式。 */
export type ProductImageFormat = 'jpeg' | 'png' | 'webp';

/** 画像の大きさの上限（2MB）。 */
export const MAXIMUM_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;

/** 形式ごとの Content-Type。 */
export const PRODUCT_IMAGE_CONTENT_TYPES: Readonly<Record<ProductImageFormat, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** WebP は「RIFF」・4 バイトの大きさ・「WEBP」で始まる。 */
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];
const WEBP_SIGNATURE_OFFSET = 8;

/** bytes の offset の位置から signature が並んでいるか。 */
function startsWithSignature(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

/**
 * 画像の形式を中身で判定する。
 * @returns 受け付ける形式ならその形式、それ以外（GIF・SVG・テキストなど、短すぎる中身を含む）は null
 */
export function detectProductImageFormat(bytes: Uint8Array): ProductImageFormat | null {
  if (startsWithSignature(bytes, JPEG_SIGNATURE)) return 'jpeg';
  if (startsWithSignature(bytes, PNG_SIGNATURE)) return 'png';
  if (startsWithSignature(bytes, RIFF_SIGNATURE) && startsWithSignature(bytes, WEBP_SIGNATURE, WEBP_SIGNATURE_OFFSET)) return 'webp';
  return null;
}

/** 画像が大きさの上限を超えている場合のエラー。 */
export class ProductImageTooLargeError extends Error {
  constructor(byteLength: number) {
    super(`画像が大きすぎます（${byteLength} バイト）`);
    this.name = 'ProductImageTooLargeError';
  }
}

/** 画像の形式を受け付けない場合のエラー。 */
export class UnsupportedProductImageError extends Error {
  constructor() {
    super('受け付けない形式の画像です');
    this.name = 'UnsupportedProductImageError';
  }
}
