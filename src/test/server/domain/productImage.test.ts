import { describe, expect, it } from 'vitest';
import { MAXIMUM_PRODUCT_IMAGE_BYTES, detectProductImageFormat } from '../../../server/domain/productImage.ts';

/** 先頭のバイト列に、残りを 0 で埋めて指定の長さにする。 */
function createBytes(header: readonly number[], length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(header);
  return bytes;
}

/** 文字列を ASCII のバイト列にする。 */
function toAsciiBytes(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_HEADER = [...toAsciiBytes('RIFF'), 0x24, 0x00, 0x00, 0x00, ...toAsciiBytes('WEBP')];

describe('画像の形式の判定（issue #41）', () => {
  it.each([
    ['JPEG', JPEG_HEADER, 'jpeg'],
    ['PNG', PNG_HEADER, 'png'],
    ['WebP', WEBP_HEADER, 'webp'],
  ])('中身が %s の場合、その形式と判定する', (_label, header, expected) => {
    expect(detectProductImageFormat(createBytes(header))).toBe(expected);
  });

  it.each([
    ['GIF', toAsciiBytes('GIF89a')],
    ['テキスト', toAsciiBytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['WebP でない RIFF（WAVE）', [...toAsciiBytes('RIFF'), 0x24, 0x00, 0x00, 0x00, ...toAsciiBytes('WAVE')]],
    ['PDF', toAsciiBytes('%PDF-1.7')],
  ])('中身が受け付けない形式（%s）の場合、null を返す', (_label, header) => {
    expect(detectProductImageFormat(createBytes(header))).toBeNull();
  });

  it('拡張子に当たる情報がなくても、中身だけで判定する（JPEG の中身を PNG と名乗らせても JPEG と判定する）', () => {
    expect(detectProductImageFormat(createBytes(JPEG_HEADER))).toBe('jpeg');
  });

  it.each([
    ['空', []],
    ['JPEG の印の途中まで', [0xff, 0xd8]],
    ['WebP の印の途中まで', toAsciiBytes('RIFF')],
  ])('中身が短すぎる（%s）場合、null を返す', (_label, bytes) => {
    expect(detectProductImageFormat(Uint8Array.from(bytes))).toBeNull();
  });

  it('画像の大きさの上限は 2MB（2,097,152 バイト）である', () => {
    expect(MAXIMUM_PRODUCT_IMAGE_BYTES).toBe(2 * 1024 * 1024);
  });
});
