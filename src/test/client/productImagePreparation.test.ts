import { describe, expect, it } from 'vitest';
import { MAXIMUM_PREPARED_IMAGE_SIDE, calculatePreparedImageSize } from '../../client/productImagePreparation.ts';

describe('送る画像の大きさ（issue #41）', () => {
  it('長い辺の上限は 800px である', () => {
    expect(MAXIMUM_PREPARED_IMAGE_SIDE).toBe(800);
  });

  it.each([
    ['横長', 4032, 3024, 800, 600],
    ['縦長', 3024, 4032, 600, 800],
    ['正方形', 2000, 2000, 800, 800],
    ['カード画像の比（1.91:1）', 1200, 630, 800, 420],
  ])('長い辺が 800px を超える（%s）場合、縦横の比を保って長い辺を 800px にする', (_label, width, height, expectedWidth, expectedHeight) => {
    expect(calculatePreparedImageSize(width, height)).toEqual({ width: expectedWidth, height: expectedHeight });
  });

  it.each([
    [800, 600],
    [640, 480],
    [1, 1],
  ])('長い辺が 800px 以下（%i×%i）の場合、大きくせずにそのままにする', (width, height) => {
    expect(calculatePreparedImageSize(width, height)).toEqual({ width, height });
  });

  it('縮めた辺は整数に丸め、1px より小さくしない', () => {
    expect(calculatePreparedImageSize(10000, 3)).toEqual({ width: 800, height: 1 });
    expect(calculatePreparedImageSize(1000, 333)).toEqual({ width: 800, height: 266 });
  });
});
