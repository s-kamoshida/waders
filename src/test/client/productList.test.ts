import { describe, expect, it } from 'vitest';
import {
  buildArchiveGroups,
  buildCategoryFilterOptions,
  buildProductListGroups,
  filterProductsByCategory,
  formatArchiveSummary,
  formatGroupSummary,
  splitProductsByArchive,
  summarizeCategoryUsage,
} from '../../client/productList.ts';
import type { ProductResponse } from '../../shared/productContract.ts';

/** 値引きなし（issue #50）。既存の商品・テストの既定の値として、フィクスチャに展開して加える。 */
const NO_DISCOUNT = { discount: null } as const;
/** 画像なし（issue #51 の画像の種類）。項目ができる前でも型に合うよう、フィクスチャには展開して加える。 */
const NO_IMAGE_KIND = { imageKind: null } as const;

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
    categoryId: null,
    categoryName: null,
    maker: null,
    note: null,
    location: null,
    handlingFee: null,
    travelExpense: null,
    otherExpense: null,
    eventStartsAt: null,
    eventEndsAt: null,
    ...NO_DISCOUNT,
    imageUrl: null,
    ...NO_IMAGE_KIND,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

/** 値引きを指定する（issue #50）。createProduct の引数に展開して渡す。 */
function withDiscount(discount: number | null) {
  return { discount };
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

  it('合計金額には、金額・送料・手数料・交通費（見込）・その他費用を含める（issue #26）', () => {
    const products = [
      createProduct({ price: 8800, shippingFee: null, handlingFee: 330, travelExpense: 2000, otherExpense: 600 }),
      createProduct({ price: 13200, shippingFee: 800, handlingFee: null, travelExpense: null, otherExpense: null }),
    ];

    const [yearGroup] = buildProductListGroups(products, { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(yearGroup?.summary).toEqual({ count: 2, totalYen: 8800 + 330 + 2000 + 600 + 13200 + 800 });
    expect(yearGroup?.months[0]?.summary).toEqual({ count: 2, totalYen: 25730 });
  });

  it('金額が未入力の商品は、手数料・交通費・その他費用が入力されていても合計金額に含めず、個数だけに含める（issue #26）', () => {
    const products = [
      createProduct({ price: null, handlingFee: 330, travelExpense: 2000, otherExpense: 600 }),
      createProduct({ price: 1000 }),
    ];

    const [yearGroup] = buildProductListGroups(products, { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(yearGroup?.summary).toEqual({ count: 2, totalYen: 1000 });
  });

  it('未購入の商品の手数料・交通費・その他費用は合計金額に含めない（issue #26）', () => {
    const products = [createProduct({ status: 'unpurchased', price: 8800, handlingFee: 330, travelExpense: 2000, otherExpense: 600 })];

    const [yearGroup] = buildProductListGroups(products, { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(yearGroup?.summary).toEqual({ count: 0, totalYen: 0 });
  });

  it('アーカイブの見出しの合計金額にも、手数料・交通費・その他費用を含める（issue #26）', () => {
    const product = createProduct({ releaseMonth: '2026-10', status: 'purchased', price: 8800, handlingFee: 330, travelExpense: 2000, otherExpense: 600 });

    const [yearGroup] = buildArchiveGroups([product], { yearMode: 'calendar' });

    expect(yearGroup?.summary).toEqual({ count: 1, totalYen: 11730 });
  });

  it('値引きがある商品は、金額・送料などの合計から値引きを引いた額を合計金額に含める（issue #50）', () => {
    const products = [
      createProduct({ price: 5000, shippingFee: 800, ...withDiscount(500) }),
      createProduct({ price: 8800, handlingFee: 330, travelExpense: 2000, otherExpense: 600, ...withDiscount(1000) }),
    ];

    const [yearGroup] = buildProductListGroups(products, { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(yearGroup?.summary).toEqual({ count: 2, totalYen: 5000 + 800 - 500 + (8800 + 330 + 2000 + 600 - 1000) });
    expect(yearGroup?.months[0]?.summary).toEqual({ count: 2, totalYen: 16030 });
  });

  it('値引きが金額を超え、送料まで値引きした商品は、合計金額に 0 円として含める（issue #50）', () => {
    const products = [createProduct({ price: 1000, shippingFee: 800, ...withDiscount(1800) }), createProduct({ price: 3000 })];

    const [yearGroup] = buildProductListGroups(products, { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(yearGroup?.summary).toEqual({ count: 2, totalYen: 3000 });
  });

  it('値引きが null や 0 円の商品は、今までどおり金額・送料などの合計を含める（issue #50）', () => {
    const products = [createProduct({ price: 5000, shippingFee: 800, ...withDiscount(null) }), createProduct({ price: 1000, ...withDiscount(0) })];

    const [yearGroup] = buildProductListGroups(products, { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(yearGroup?.summary).toEqual({ count: 2, totalYen: 6800 });
  });

  it('未購入の商品は、値引きがあっても合計金額に含めない（ほかの商品の合計から値引きを引かない。issue #50）', () => {
    const products = [
      createProduct({ status: 'unpurchased', price: 5000, ...withDiscount(500) }),
      createProduct({ price: 1000 }),
    ];

    const [yearGroup] = buildProductListGroups(products, { currentMonth: '2026-11', yearMode: 'calendar' });

    expect(yearGroup?.summary).toEqual({ count: 1, totalYen: 1000 });
  });

  it('アーカイブの見出しの合計金額からも、値引きを引く（issue #50）', () => {
    const product = createProduct({ releaseMonth: '2026-10', status: 'purchased', price: 5000, shippingFee: 800, ...withDiscount(500) });

    const [yearGroup] = buildArchiveGroups([product], { yearMode: 'calendar' });

    expect(yearGroup?.summary).toEqual({ count: 1, totalYen: 5300 });
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

describe('カテゴリーの絞り込み（issue #10）', () => {
  const scale = createProduct({ categoryId: 'scale', categoryName: 'スケールフィギュア' });
  const action = createProduct({ categoryId: 'action', categoryName: '可動フィギュア' });
  const uncategorized = createProduct({ categoryId: null, categoryName: null });
  const products = [scale, action, uncategorized];

  it('何も選んでいない場合、すべての商品を返す', () => {
    expect(filterProductsByCategory(products, { categoryIds: new Set(), includesUncategorized: false })).toEqual(products);
  });

  it('選んだカテゴリーの商品だけを返す（複数選べる）', () => {
    expect(filterProductsByCategory(products, { categoryIds: new Set(['scale', 'action']), includesUncategorized: false })).toEqual([
      scale,
      action,
    ]);
  });

  it('「カテゴリー未設定」を選んだ場合、カテゴリーのない商品を返す', () => {
    expect(filterProductsByCategory(products, { categoryIds: new Set(['scale']), includesUncategorized: true })).toEqual([
      scale,
      uncategorized,
    ]);
  });
});

describe('絞り込みの選択肢（issue #10）', () => {
  const categories = [
    { id: 'scale', name: 'スケールフィギュア' },
    { id: 'action', name: '可動フィギュア' },
  ];

  it('定義の並び順で選択肢を作る', () => {
    expect(buildCategoryFilterOptions(categories, [])).toEqual([
      { id: 'scale', label: 'スケールフィギュア' },
      { id: 'action', label: '可動フィギュア' },
    ]);
  });

  it('定義にないカテゴリーの商品がある場合、「名前（定義にない）」として定義の後に重複なく加える', () => {
    const products = [
      createProduct({ categoryId: 'legacy', categoryName: '旧カテゴリー' }),
      createProduct({ categoryId: 'scale', categoryName: 'スケールフィギュア' }),
      createProduct({ categoryId: 'legacy', categoryName: '旧カテゴリー' }),
    ];

    expect(buildCategoryFilterOptions(categories, products)).toEqual([
      { id: 'scale', label: 'スケールフィギュア' },
      { id: 'action', label: '可動フィギュア' },
      { id: 'legacy', label: '旧カテゴリー（定義にない）' },
    ]);
  });
});

describe('カテゴリーの使われ方の集計（カテゴリーの管理。issue #10）', () => {
  const categories = [
    { id: 'scale', name: 'スケールフィギュア' },
    { id: 'action', name: '可動フィギュア' },
  ];

  it('定義の並び順で、各カテゴリーを使っている商品の数（アーカイブの商品を含む）を数え、使っていなければ 0 にする', () => {
    const products = [
      createProduct({ categoryId: 'scale', categoryName: 'スケールフィギュア' }),
      createProduct({ categoryId: 'scale', categoryName: 'スケールフィギュア', releaseMonth: '2026-09', status: 'purchased' }),
      createProduct(),
    ];

    expect(summarizeCategoryUsage(categories, products).definedCategories).toEqual([
      { id: 'scale', name: 'スケールフィギュア', productCount: 2 },
      { id: 'action', name: '可動フィギュア', productCount: 0 },
    ]);
  });

  it('定義にないカテゴリーを、最初に現れた商品の順に、最後に保存した名前と商品の数で重複なく返す', () => {
    const products = [
      createProduct({ categoryId: 'removed-b', categoryName: '旧カテゴリー B' }),
      createProduct({ categoryId: 'scale', categoryName: 'スケールフィギュア' }),
      createProduct({ categoryId: 'removed-a', categoryName: '旧カテゴリー A' }),
      createProduct({ categoryId: 'removed-b', categoryName: '旧カテゴリー B' }),
    ];

    expect(summarizeCategoryUsage(categories, products).undefinedCategories).toEqual([
      { id: 'removed-b', name: '旧カテゴリー B', productCount: 2 },
      { id: 'removed-a', name: '旧カテゴリー A', productCount: 1 },
    ]);
  });

  it('定義にないカテゴリーの商品がない場合、定義にないカテゴリーは空にする', () => {
    expect(summarizeCategoryUsage(categories, [createProduct(), createProduct({ categoryId: 'action', categoryName: '可動フィギュア' })]).undefinedCategories).toEqual([]);
  });
});
