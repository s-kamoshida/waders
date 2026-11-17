import { describe, expect, it } from 'vitest';
import {
  MAXIMUM_PRICE_YEN,
  MAXIMUM_PRODUCT_NAME_LENGTH,
  productInputSchema,
} from '../../shared/productContract.ts';

/** 必須項目だけを持つ入力。 */
const minimumInput = { name: 'アクションフィギュア セカンド・フォーム', releaseMonth: '2026-12' };

/** 入力を検証し、成功したかどうかを返す。 */
function isValid(input: unknown): boolean {
  return productInputSchema.safeParse(input).success;
}

describe('必須項目', () => {
  it('必須項目だけがそろっている場合、検証に通り、ステータスは検討中、キャンセル可否は不可、任意の項目は未入力になる', () => {
    const product = productInputSchema.parse(minimumInput);

    expect(product).toEqual({
      name: 'アクションフィギュア セカンド・フォーム',
      releaseMonth: '2026-12',
      status: 'considering',
      cancelable: false,
      price: null,
      shippingFee: null,
      orderDeadline: null,
      url: null,
      category: null,
    });
  });

  it.each(['name', 'releaseMonth'])('%s がない場合、拒否する', (fieldName) => {
    const input = Object.fromEntries(Object.entries(minimumInput).filter(([key]) => key !== fieldName));

    expect(isValid(input)).toBe(false);
  });
});

describe('商品名', () => {
  it('前後の空白を取り除く', () => {
    expect(productInputSchema.parse({ ...minimumInput, name: '  figma  ' }).name).toBe('figma');
  });

  it('空白だけの場合、拒否する', () => {
    expect(isValid({ ...minimumInput, name: '   ' })).toBe(false);
  });

  it('上限の文字数までは受け付け、超える場合は拒否する', () => {
    expect(isValid({ ...minimumInput, name: 'あ'.repeat(MAXIMUM_PRODUCT_NAME_LENGTH) })).toBe(true);
    expect(isValid({ ...minimumInput, name: 'あ'.repeat(MAXIMUM_PRODUCT_NAME_LENGTH + 1) })).toBe(false);
  });
});

describe('発売月', () => {
  it.each(['2026-01', '2026-12'])('年と月の形式（%s）の場合、受け付ける', (releaseMonth) => {
    expect(isValid({ ...minimumInput, releaseMonth })).toBe(true);
  });

  it.each(['2026-13', '2026-00', '2026-1', '2026/11', '2026-11-01', ''])(
    '年と月の形式でない（"%s"）場合、拒否する',
    (releaseMonth) => {
      expect(isValid({ ...minimumInput, releaseMonth })).toBe(false);
    },
  );
});

describe('ステータス', () => {
  it.each(['considering', 'reserved', 'purchased', 'unpurchased'])('%s を受け付ける', (status) => {
    expect(isValid({ ...minimumInput, status })).toBe(true);
  });

  it('要件にないステータス（キャンセル）の場合、拒否する', () => {
    expect(isValid({ ...minimumInput, status: 'cancelled' })).toBe(false);
  });
});

describe('受注期限', () => {
  it('日付の形式の場合、受け付ける', () => {
    expect(productInputSchema.parse({ ...minimumInput, orderDeadline: '2026-11-20' }).orderDeadline).toBe('2026-11-20');
  });

  it.each(['2026-02-30', '2026-11-20T12:00', '2026/11/20', '2026-11'])(
    '存在しない日付や日付以外の形式（"%s"）の場合、拒否する',
    (orderDeadline) => {
      expect(isValid({ ...minimumInput, orderDeadline })).toBe(false);
    },
  );
});

describe('金額と送料', () => {
  it.each(['price', 'shippingFee'])('%s が 0 円と上限の金額の場合、受け付ける', (fieldName) => {
    expect(isValid({ ...minimumInput, [fieldName]: 0 })).toBe(true);
    expect(isValid({ ...minimumInput, [fieldName]: MAXIMUM_PRICE_YEN })).toBe(true);
  });

  it('上限の金額は 9,999,999 円である', () => {
    expect(MAXIMUM_PRICE_YEN).toBe(9_999_999);
  });

  it.each([
    ['price', -1],
    ['price', MAXIMUM_PRICE_YEN + 1],
    ['price', 100.5],
    ['shippingFee', -1],
    ['shippingFee', MAXIMUM_PRICE_YEN + 1],
    ['shippingFee', 100.5],
  ])('%s が範囲外または整数でない（%s）場合、拒否する', (fieldName, value) => {
    expect(isValid({ ...minimumInput, [fieldName]: value })).toBe(false);
  });
});

describe('URL', () => {
  it.each(['https://shop.example.jp/item/1', 'http://shop.example.jp/item/1'])('%s を受け付ける', (url) => {
    expect(isValid({ ...minimumInput, url })).toBe(true);
  });

  it.each(['javascript:alert(1)', 'ftp://shop.example.jp/item', 'shop.example.jp/item'])(
    'http・https 以外（"%s"）の場合、拒否する',
    (url) => {
      expect(isValid({ ...minimumInput, url })).toBe(false);
    },
  );
});
