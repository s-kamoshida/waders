import { describe, expect, it } from 'vitest';
import {
  MAXIMUM_MAKER_LENGTH,
  MAXIMUM_NOTE_LENGTH,
  MAXIMUM_PRICE_YEN,
  MAXIMUM_PRODUCT_NAME_LENGTH,
  collectFieldErrors,
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
      categoryId: null,
      maker: null,
      note: null,
      location: null,
      handlingFee: null,
      travelExpense: null,
      otherExpense: null,
      eventStartsAt: null,
      eventEndsAt: null,
      discount: null,
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

describe('メーカーと備考（issue #18）', () => {
  it('メーカーの上限は 100 文字、備考の上限は 1,000 文字である', () => {
    expect(MAXIMUM_MAKER_LENGTH).toBe(100);
    expect(MAXIMUM_NOTE_LENGTH).toBe(1000);
  });

  it('前後の空白を取り除き、備考の途中の改行は残す', () => {
    const product = productInputSchema.parse({ ...minimumInput, maker: '  メーカーA ', note: '\n 初回特典付き\n分割で届く \n' });

    expect(product.maker).toBe('メーカーA');
    expect(product.note).toBe('初回特典付き\n分割で届く');
  });

  it('メーカーは上限の文字数までは受け付け、超える場合は文言とともに拒否する', () => {
    expect(isValid({ ...minimumInput, maker: 'あ'.repeat(MAXIMUM_MAKER_LENGTH) })).toBe(true);

    const result = productInputSchema.safeParse({ ...minimumInput, maker: 'あ'.repeat(MAXIMUM_MAKER_LENGTH + 1) });

    expect(result.error?.issues[0]?.message).toBe('メーカーは 100 文字以内で入力してください。');
  });

  it('備考は上限の文字数までは受け付け、超える場合は文言とともに拒否する', () => {
    expect(isValid({ ...minimumInput, note: 'あ'.repeat(MAXIMUM_NOTE_LENGTH) })).toBe(true);

    const result = productInputSchema.safeParse({ ...minimumInput, note: 'あ'.repeat(MAXIMUM_NOTE_LENGTH + 1) });

    expect(result.error?.issues[0]?.message).toBe('備考は 1,000 文字以内で入力してください。');
  });

  it.each([
    ['maker', '   '],
    ['note', ' \n '],
  ])('%s が空白だけの場合、拒否する（未入力は null で送る）', (fieldName, value) => {
    expect(isValid({ ...minimumInput, [fieldName]: value })).toBe(false);
  });
});

describe('場所と費用（issue #26）', () => {
  it.each(['handlingFee', 'travelExpense', 'otherExpense'])('%s は、金額と同じく 0 円と上限の金額（9,999,999 円）を受け付ける', (fieldName) => {
    expect(isValid({ ...minimumInput, [fieldName]: 0 })).toBe(true);
    expect(isValid({ ...minimumInput, [fieldName]: 9_999_999 })).toBe(true);
  });

  it.each([
    ['handlingFee', -1],
    ['handlingFee', 10_000_000],
    ['handlingFee', 100.5],
    ['travelExpense', -1],
    ['travelExpense', 10_000_000],
    ['travelExpense', 100.5],
    ['otherExpense', -1],
    ['otherExpense', 10_000_000],
    ['otherExpense', 100.5],
  ])('%s が範囲外または整数でない（%s）場合、拒否する', (fieldName, value) => {
    expect(isValid({ ...minimumInput, [fieldName]: value })).toBe(false);
  });

  it('費用が上限を超える場合、金額と同じ文言で拒否する', () => {
    const result = productInputSchema.safeParse({ ...minimumInput, handlingFee: 10_000_000 });

    expect(result.error?.issues[0]).toMatchObject({ path: ['handlingFee'], message: '金額は 9,999,999 円以下で入力してください。' });
  });

  it('場所の前後の空白を取り除く', () => {
    expect(productInputSchema.parse({ ...minimumInput, location: '  東京ドーム ' }).location).toBe('東京ドーム');
  });

  it('場所は 100 文字までは受け付け、超える場合は文言とともに拒否する', () => {
    expect(isValid({ ...minimumInput, location: 'あ'.repeat(100) })).toBe(true);

    const result = productInputSchema.safeParse({ ...minimumInput, location: 'あ'.repeat(101) });

    expect(result.error?.issues[0]).toMatchObject({ path: ['location'], message: '場所は 100 文字以内で入力してください。' });
  });

  it('場所が空白だけの場合、文言とともに拒否する（未入力は null で送る）', () => {
    const result = productInputSchema.safeParse({ ...minimumInput, location: '   ' });

    expect(result.error?.issues[0]).toMatchObject({ path: ['location'], message: '場所を入力しない場合は空にしてください。' });
  });
});

describe('開催日時と終了日時（PR #30 のレビュー）', () => {
  it('UTC の ISO 8601 の日時を受け付ける', () => {
    const product = productInputSchema.parse({
      ...minimumInput,
      eventStartsAt: '2026-11-20T09:00:00.000Z',
      eventEndsAt: '2026-11-20T12:00:00.000Z',
    });

    expect(product).toMatchObject({ eventStartsAt: '2026-11-20T09:00:00.000Z', eventEndsAt: '2026-11-20T12:00:00.000Z' });
  });

  it.each(['eventStartsAt', 'eventEndsAt'])('%s だけを入力した場合も受け付ける', (fieldName) => {
    expect(isValid({ ...minimumInput, [fieldName]: '2026-11-20T09:00:00.000Z' })).toBe(true);
  });

  it.each([
    ['日付だけ', '2026-11-20'],
    ['時差のない日時（日本時間の入力欄の値のまま）', '2026-11-20T18:00'],
    ['日時でない文字列', '11月20日 18時'],
    ['存在しない日時', '2026-02-30T09:00:00.000Z'],
  ])('%s（%s）の場合、拒否する', (_label, value) => {
    expect(isValid({ ...minimumInput, eventStartsAt: value })).toBe(false);
    expect(isValid({ ...minimumInput, eventEndsAt: value })).toBe(false);
  });

  it('終了日時が開催日時より前の場合、終了日時の誤りとして文言とともに拒否する', () => {
    const result = productInputSchema.safeParse({
      ...minimumInput,
      eventStartsAt: '2026-11-20T09:00:00.000Z',
      eventEndsAt: '2026-11-20T08:59:00.000Z',
    });

    expect(result.error?.issues[0]).toMatchObject({ path: ['eventEndsAt'], message: '終了日時は開催日時以降にしてください。' });
  });

  it('終了日時が開催日時と同じ場合は受け付ける', () => {
    expect(isValid({ ...minimumInput, eventStartsAt: '2026-11-20T09:00:00.000Z', eventEndsAt: '2026-11-20T09:00:00.000Z' })).toBe(true);
  });
});

describe('値引き（issue #50・BR-35）', () => {
  /** 値引きが合計を超える場合の文言（MSG-V-031）。 */
  const DISCOUNT_EXCEEDS_TOTAL_MESSAGE = '値引きは、金額と送料などの合計以下で入力してください。';
  /** 金額が空のまま値引きを入れた場合の文言（MSG-V-032）。 */
  const DISCOUNT_WITHOUT_PRICE_MESSAGE = '値引きを入力する場合は、金額も入力してください。';
  /** 金額・送料・手数料・交通費（見込）・その他費用（合計 8,730 円）。 */
  const ALL_COSTS = { price: 5000, shippingFee: 800, handlingFee: 330, travelExpense: 2000, otherExpense: 600 };

  /** 入力を検証し、値引きの欄に表示する文言（誤りがなければ undefined）を返す。 */
  function findDiscountError(input: Record<string, unknown>): string | undefined {
    const result = productInputSchema.safeParse({ ...minimumInput, ...input });
    return result.success ? undefined : collectFieldErrors(result.error).discount;
  }

  it('金額があり、値引きがその範囲内の場合、値引きを受け付ける', () => {
    expect(productInputSchema.parse({ ...minimumInput, price: 5000, discount: 500 })).toMatchObject({ price: 5000, discount: 500 });
  });

  it('値引きが null の場合、値引きなし（null）として受け付ける', () => {
    expect(productInputSchema.parse({ ...minimumInput, price: 5000, discount: null })).toMatchObject({ discount: null });
  });

  it('値引きが 0 円の場合、受け付ける', () => {
    expect(productInputSchema.parse({ ...minimumInput, price: 5000, discount: 0 })).toMatchObject({ discount: 0 });
  });

  it('値引きが上限の金額（9,999,999 円）で、合計がそれ以上の場合、受け付ける', () => {
    const input = { ...minimumInput, price: MAXIMUM_PRICE_YEN, discount: MAXIMUM_PRICE_YEN };

    expect(productInputSchema.parse(input)).toMatchObject({ discount: 9_999_999 });
  });

  it.each([
    [-1, '金額は 0 円以上で入力してください。'],
    [10_000_000, '金額は 9,999,999 円以下で入力してください。'],
    [100.5, '金額は整数で入力してください。'],
  ])('値引きが範囲外または整数でない（%s）場合、金額と同じ文言で拒否する', (discount, message) => {
    expect(findDiscountError({ price: MAXIMUM_PRICE_YEN, shippingFee: MAXIMUM_PRICE_YEN, discount })).toBe(message);
  });

  it('値引きが、金額・送料・手数料・交通費（見込）・その他費用の合計と同じ場合、受け付ける', () => {
    expect(productInputSchema.parse({ ...minimumInput, ...ALL_COSTS, discount: 8730 })).toMatchObject({ discount: 8730 });
  });

  it('値引きが、金額・送料・手数料・交通費（見込）・その他費用の合計を超える場合、値引きの誤りとして文言とともに拒否する', () => {
    expect(findDiscountError({ ...ALL_COSTS, discount: 8731 })).toBe(DISCOUNT_EXCEEDS_TOTAL_MESSAGE);
  });

  it('値引きが金額を超えても、送料などを含めた合計以下の場合（ポイントで送料まで払う場合）、受け付ける', () => {
    expect(productInputSchema.parse({ ...minimumInput, price: 1000, shippingFee: 800, discount: 1800 })).toMatchObject({ discount: 1800 });
  });

  it('送料などがなく、値引きが金額を超える場合、値引きの誤りとして文言とともに拒否する', () => {
    expect(findDiscountError({ price: 1000, discount: 1001 })).toBe(DISCOUNT_EXCEEDS_TOTAL_MESSAGE);
  });

  it('金額が空のまま値引きを入れた場合、値引きの誤りとして文言とともに拒否する', () => {
    expect(findDiscountError({ price: null, discount: 500 })).toBe(DISCOUNT_WITHOUT_PRICE_MESSAGE);
  });

  it('金額が空で、値引きが送料などの範囲内の場合も、金額が空の文言で拒否する', () => {
    expect(findDiscountError({ price: null, shippingFee: 800, handlingFee: 330, discount: 500 })).toBe(DISCOUNT_WITHOUT_PRICE_MESSAGE);
  });

  it('金額が空のまま値引きを 0 円にした場合も、金額が空の文言で拒否する（値の有無で判断する）', () => {
    expect(findDiscountError({ price: null, discount: 0 })).toBe(DISCOUNT_WITHOUT_PRICE_MESSAGE);
  });

  it('金額も値引きも空の場合は、今までどおり受け付ける', () => {
    expect(isValid({ ...minimumInput, price: null, shippingFee: 800, discount: null })).toBe(true);
  });
});
