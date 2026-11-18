import { describe, expect, it } from 'vitest';
import {
  buildArchiveGroups,
  buildProductListGroups,
  formatArchiveSummary,
  formatGroupSummary,
  splitProductsByArchive,
} from '../../client/productList.ts';
import type { ProductResponse } from '../../shared/productContract.ts';

let createdCount = 0;

/** テスト用の商品を作る。登録日時は作った順に進む。 */
function createProduct(overrides: Partial<ProductResponse> = {}): ProductResponse {
  createdCount += 1;
  const createdAt = new Date(Date.UTC(2026, 10, 1, 0, createdCount)).toISOString();
  return {
    id: `product-${createdCount}`,
    name: `商品 ${createdCount}`,
    releaseMonth: '2026-11',
    status: 'reserved',
    cancelable: false,
    price: null,
    shippingFee: null,
    orderDeadline: null,
    url: null,
    category: null,
    maker: null,
    note: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

/** グループの月の一覧を返す。 */
function listMonths(groups: ReturnType<typeof buildProductListGroups>): string[] {
  return groups.flatMap((yearGroup) => yearGroup.months.map((monthGroup) => monthGroup.month));
}

describe('表示する月の範囲', () => {
  it('当月から、最も遅い発売月まで、0 件の月も含めて並べる', () => {
    const products = [createProduct({ releaseMonth: '2027-02' }), createProduct({ releaseMonth: '2026-11' })];

    const groups = buildProductListGroups(products, { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(listMonths(groups)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(groups[0]?.months[1]?.products).toEqual([]);
  });

  it('商品がない場合、当月だけを表示する', () => {
    const groups = buildProductListGroups([], { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(listMonths(groups)).toEqual(['2026-11']);
  });

  it('当月より前の発売月の商品がある場合、その月から表示する', () => {
    const products = [createProduct({ releaseMonth: '2026-09' }), createProduct({ releaseMonth: '2026-12' })];

    const groups = buildProductListGroups(products, { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(listMonths(groups)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12']);
  });
});

describe('年のグループ', () => {
  const products = [createProduct({ releaseMonth: '2027-03' }), createProduct({ releaseMonth: '2027-04' })];

  it('暦年の場合、1 月〜12 月でまとめ、「2026年」と表記する', () => {
    const groups = buildProductListGroups(products, { currentMonth: '2026-12', yearMode: 'calendar' });

    expect(groups.map((group) => [group.label, group.months.map((month) => month.month)])).toEqual([
      ['2026年', ['2026-12']],
      ['2027年', ['2027-01', '2027-02', '2027-03', '2027-04']],
    ]);
  });

  it('年度の場合、4 月〜翌 3 月でまとめ、開始年で「FY26」と表記する', () => {
    const groups = buildProductListGroups(products, { currentMonth: '2026-12', yearMode: 'fiscal' });

    expect(groups.map((group) => [group.label, group.months.map((month) => month.month)])).toEqual([
      ['FY26', ['2026-12', '2027-01', '2027-02', '2027-03']],
      ['FY27', ['2027-04']],
    ]);
  });

  it('月の表記は「2026/11」とする', () => {
    const groups = buildProductListGroups([], { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(groups[0]?.months[0]?.label).toBe('2026/11');
  });
});

describe('同じ月の中の並び順', () => {
  it('購入済、予約済、予約済（キャンセル可）、検討中、未購入の順に並べ、同じステータスの中は登録順にする', () => {
    const considering = createProduct({ status: 'considering' });
    const unpurchased = createProduct({ status: 'unpurchased' });
    const cancelableReserved = createProduct({ status: 'reserved', cancelable: true });
    const firstReserved = createProduct({ status: 'reserved' });
    const purchased = createProduct({ status: 'purchased' });
    const secondReserved = createProduct({ status: 'reserved' });

    const groups = buildProductListGroups(
      [considering, unpurchased, cancelableReserved, firstReserved, purchased, secondReserved],
      { currentMonth: '2026-11', yearMode: 'calendar' },
    );

    expect(groups[0]?.months[0]?.products.map((product) => product.id)).toEqual([
      purchased.id,
      firstReserved.id,
      secondReserved.id,
      cancelableReserved.id,
      considering.id,
      unpurchased.id,
    ]);
  });
});

describe('見出しの個数と合計金額', () => {
  it('個数と、金額と送料の合計を求める。未購入は含めず、金額が未入力の商品は個数だけに含める', () => {
    const products = [
      createProduct({ releaseMonth: '2026-11', price: 19800, shippingFee: 0 }),
      createProduct({ releaseMonth: '2026-11', status: 'considering', price: 24200, shippingFee: null }),
      createProduct({ releaseMonth: '2026-11', status: 'unpurchased', price: 18700, shippingFee: 660 }),
      createProduct({ releaseMonth: '2026-11', price: null, shippingFee: 500 }),
      createProduct({ releaseMonth: '2027-01', cancelable: true, price: 30800, shippingFee: 800 }),
    ];

    const groups = buildProductListGroups(products, { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(groups.map((group) => [group.label, group.summary])).toEqual([
      ['2026年', { count: 3, totalYen: 44000 }],
      ['2027年', { count: 1, totalYen: 31600 }],
    ]);
    expect(groups[0]?.months.map((month) => month.summary)).toEqual([
      { count: 3, totalYen: 44000 },
      { count: 0, totalYen: 0 },
    ]);
  });

  it('見出しの集計を「3個（合計 44,000円見込）」と表記する', () => {
    expect(formatGroupSummary({ count: 3, totalYen: 44000 })).toBe('3個（合計 44,000円見込）');
  });
});

describe('アーカイブの振り分け（issue #9）', () => {
  it('発売月が当月より前の商品をアーカイブ、当月以降の商品をリストに振り分ける', () => {
    const october = createProduct({ releaseMonth: '2026-10' });
    const november = createProduct({ releaseMonth: '2026-11' });
    const january = createProduct({ releaseMonth: '2027-01' });

    const { active, archived } = splitProductsByArchive([october, november, january], '2026-11');

    expect(active.map((product) => product.id)).toEqual([november.id, january.id]);
    expect(archived.map((product) => product.id)).toEqual([october.id]);
  });
});

describe('アーカイブのグループ（issue #9）', () => {
  it('新しい月から順に並べ、商品のある月だけを表示する', () => {
    const products = [
      createProduct({ releaseMonth: '2026-08' }),
      createProduct({ releaseMonth: '2026-10' }),
      createProduct({ releaseMonth: '2025-12' }),
    ];

    const groups = buildArchiveGroups(products, { yearMode: 'calendar' });

    expect(groups.map((group) => [group.label, group.months.map((month) => month.month)])).toEqual([
      ['2026年', ['2026-10', '2026-08']],
      ['2025年', ['2025-12']],
    ]);
  });

  it('年度でまとめることもできる', () => {
    const groups = buildArchiveGroups([createProduct({ releaseMonth: '2026-03' }), createProduct({ releaseMonth: '2026-04' })], {
      yearMode: 'fiscal',
    });

    expect(groups.map((group) => group.label)).toEqual(['FY26', 'FY25']);
  });

  it('同じ月の中の並び順と集計は、リストと同じ規則にする', () => {
    const unpurchased = createProduct({ releaseMonth: '2026-10', status: 'unpurchased', price: 18700 });
    const purchased = createProduct({ releaseMonth: '2026-10', status: 'purchased', price: 22000, shippingFee: 800 });

    const [yearGroup] = buildArchiveGroups([unpurchased, purchased], { yearMode: 'calendar' });

    expect(yearGroup?.months[0]?.products.map((product) => product.id)).toEqual([purchased.id, unpurchased.id]);
    expect(yearGroup?.months[0]?.summary).toEqual({ count: 1, totalYen: 22800 });
  });

  it('アーカイブの見出しの集計は、見込みではないため「1個（合計 22,800円）」と表記する', () => {
    expect(formatArchiveSummary({ count: 1, totalYen: 22800 })).toBe('1個（合計 22,800円）');
  });
});
