// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductCard } from '../../../client/components/ProductCard.tsx';
import type { ProductResponse } from '../../../shared/productContract.ts';
import type { CategoryResponse } from '../../../shared/categoryContract.ts';

/** 値引きなし（issue #50）。既存の商品・テストの既定の値として、フィクスチャに展開して加える。 */
const NO_DISCOUNT = { discount: null } as const;
/** 画像なし（issue #51 の画像の種類）。項目ができる前でも型に合うよう、フィクスチャには展開して加える。 */
const NO_IMAGE_KIND = { imageKind: null } as const;

const today = '2026-11-17';

/** テスト用の商品を作る。 */
function createProduct(overrides: Partial<ProductResponse> = {}): ProductResponse {
  return {
    id: 'product-1',
    name: 'オリジナルキャラクター シュガー ver.',
    releaseMonth: '2026-11',
    status: 'reserved',
    cancelable: false,
    price: 24200,
    shippingFee: 800,
    orderDeadline: null,
    url: 'https://shop.example.jp/item/1',
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
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProductCard', () => {
  it('商品名・ステータス・送料込みの金額・送料を表示する（送料込みは issue #70）', () => {
    render(<ProductCard product={createProduct()} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('オリジナルキャラクター シュガー ver.')).toBeInTheDocument();
    expect(screen.getByText('予約済')).toBeInTheDocument();
    expect(screen.getByText('25,000円')).toBeInTheDocument();
    expect(screen.getByText('送料800円を含む')).toBeInTheDocument();
  });

  it('送料が未入力の場合、「送料無料」と表示する', () => {
    render(<ProductCard product={createProduct({ shippingFee: null })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('送料無料')).toBeInTheDocument();
  });

  it('購入先のドメインを、新しいタブで開くリンクとして表示する', () => {
    render(<ProductCard product={createProduct()} today={today} onSelect={vi.fn()} />);

    const link = screen.getByRole('link', { name: 'shop.example.jp' });
    expect(link).toHaveAttribute('href', 'https://shop.example.jp/item/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('予約済でキャンセル可の場合、「予約済（キャンセル可）」と表示する', () => {
    render(<ProductCard product={createProduct({ cancelable: true })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('予約済（キャンセル可）')).toBeInTheDocument();
  });

  it('検討中で受注期限まで 1 週間以下の場合、商品名の先頭に ⚠️ を付け、受注期限を表示する', () => {
    render(
      <ProductCard
        product={createProduct({ status: 'considering', orderDeadline: '2026-11-20' })}
        today={today}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('⚠️ オリジナルキャラクター シュガー ver.')).toBeInTheDocument();
    expect(screen.getByText('受注期限 11/20')).toBeInTheDocument();
  });

  it('予約済の場合、受注期限が近くても ⚠️ を付けず、受注期限も表示しない', () => {
    render(<ProductCard product={createProduct({ orderDeadline: '2026-11-20' })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('オリジナルキャラクター シュガー ver.')).toBeInTheDocument();
    expect(screen.queryByText(/⚠️/)).not.toBeInTheDocument();
    expect(screen.queryByText(/受注期限/)).not.toBeInTheDocument();
  });

  it('メーカーがある場合、商品名の上に表示する（issue #18）', () => {
    render(<ProductCard product={createProduct({ maker: 'メーカーA' })} today={today} onSelect={vi.fn()} />);

    const maker = screen.getByText('メーカーA');
    const name = screen.getByText('オリジナルキャラクター シュガー ver.');
    expect(maker.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('備考がある場合、本文は出さずに「備考あり」の印（📝）を表示する（issue #18）', () => {
    render(<ProductCard product={createProduct({ note: '初回特典付き' })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByRole('img', { name: '備考あり' })).toHaveTextContent('📝');
    expect(screen.queryByText('初回特典付き')).not.toBeInTheDocument();
  });

  it('メーカーと備考が未入力の場合、どちらも表示しない（issue #18）', () => {
    render(<ProductCard product={createProduct()} today={today} onSelect={vi.fn()} />);

    expect(screen.queryByRole('img', { name: '備考あり' })).not.toBeInTheDocument();
    expect(screen.getByRole('button').querySelector('.product-card-maker')).toBeNull();
  });

  it('カードをクリックした場合、その商品を onSelect に渡す', async () => {
    const onSelect = vi.fn();
    const product = createProduct();
    render(<ProductCard product={product} today={today} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole('button', { name: /オリジナルキャラクター シュガー ver\./ }));

    expect(onSelect).toHaveBeenCalledWith(product);
  });

  it('購入先のリンクをクリックした場合は、onSelect を呼ばない', async () => {
    const onSelect = vi.fn();
    render(<ProductCard product={createProduct()} today={today} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole('link', { name: 'shop.example.jp' }));

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('場所と費用・カテゴリーごとの入力項目（issue #26・#27）', () => {
  /** 物品のカテゴリー（既定の項目の設定）。 */
  const figureCategory: CategoryResponse = {
    id: 'scale',
    name: 'スケールフィギュア',
    fields: ['shippingFee', 'maker', 'orderDeadline', 'cancelable'],
    otherExpenseLabel: 'その他費用',
  };
  /** 電子チケットのカテゴリー（送料を使わず、場所と費用を使う。その他費用の名前は「ドリンク代」）。 */
  const ticketCategory: CategoryResponse = {
    id: 'ticket',
    name: '電子チケット',
    fields: ['location', 'handlingFee', 'travelExpense', 'otherExpense'],
    otherExpenseLabel: 'ドリンク代',
  };
  const categories = [figureCategory, ticketCategory];
  const ticketProduct = (overrides: Partial<ProductResponse> = {}) =>
    createProduct({ categoryId: 'ticket', categoryName: '電子チケット', price: 8800, shippingFee: null, ...overrides });

  it('場所がある場合、商品名の下に表示する', () => {
    render(<ProductCard product={ticketProduct({ location: '東京ドーム' })} today={today} onSelect={vi.fn()} categories={categories} />);

    const name = screen.getByText('オリジナルキャラクター シュガー ver.');
    const location = screen.getByText('東京ドーム');
    expect(name.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('手数料・交通費（見込）・その他費用がある場合、項目ごとに表示し、その他費用はカテゴリーの名前で示す', () => {
    render(
      <ProductCard
        product={ticketProduct({ handlingFee: 330, travelExpense: 2000, otherExpense: 600 })}
        today={today}
        onSelect={vi.fn()}
        categories={categories}
      />,
    );

    expect(screen.getByText('手数料 330円')).toBeInTheDocument();
    expect(screen.getByText('交通費（見込） 2,000円')).toBeInTheDocument();
    expect(screen.getByText('ドリンク代 600円')).toBeInTheDocument();
  });

  it('場所と費用が未入力の場合、どれも表示しない', () => {
    render(<ProductCard product={ticketProduct()} today={today} onSelect={vi.fn()} categories={categories} />);

    expect(screen.queryByText(/手数料|交通費|ドリンク代|その他費用/)).not.toBeInTheDocument();
  });

  it('カテゴリー未設定の商品のその他費用は「その他費用」と示す', () => {
    render(<ProductCard product={createProduct({ otherExpense: 600 })} today={today} onSelect={vi.fn()} categories={categories} />);

    expect(screen.getByText('その他費用 600円')).toBeInTheDocument();
  });

  it('送料を使わないカテゴリーの商品で、送料が未入力の場合、「送料無料」と表示しない', () => {
    render(<ProductCard product={ticketProduct()} today={today} onSelect={vi.fn()} categories={categories} />);

    expect(screen.getByText('8,800円')).toBeInTheDocument();
    expect(screen.queryByText('送料無料')).not.toBeInTheDocument();
  });

  it('送料を使わないカテゴリーの商品でも、送料が保存されている場合は表示する（金額に含める。issue #70）', () => {
    render(<ProductCard product={ticketProduct({ shippingFee: 800 })} today={today} onSelect={vi.fn()} categories={categories} />);

    expect(screen.getByText('9,600円')).toBeInTheDocument();
    expect(screen.getByText('送料800円を含む')).toBeInTheDocument();
  });

  it('送料を使うカテゴリーの商品で、送料が未入力の場合、「送料無料」と表示する', () => {
    render(
      <ProductCard
        product={createProduct({ categoryId: 'scale', categoryName: 'スケールフィギュア', shippingFee: null })}
        today={today}
        onSelect={vi.fn()}
        categories={categories}
      />,
    );

    expect(screen.getByText('送料無料')).toBeInTheDocument();
  });

  it('カテゴリー未設定・定義にないカテゴリーの商品で、送料が未入力の場合、今までどおり「送料無料」と表示する', () => {
    const { unmount } = render(
      <ProductCard product={createProduct({ shippingFee: null })} today={today} onSelect={vi.fn()} categories={categories} />,
    );
    expect(screen.getByText('送料無料')).toBeInTheDocument();
    unmount();

    render(
      <ProductCard
        product={createProduct({ categoryId: 'removed', categoryName: 'プライズ', shippingFee: null })}
        today={today}
        onSelect={vi.fn()}
        categories={categories}
      />,
    );
    expect(screen.getByText('送料無料')).toBeInTheDocument();
  });

  it('カテゴリーの定義を読めない場合（categories が null）、送料が未入力なら「送料無料」と表示し、その他費用は「その他費用」と示す', () => {
    render(
      <ProductCard product={ticketProduct({ otherExpense: 600 })} today={today} onSelect={vi.fn()} categories={null} />,
    );

    expect(screen.getByText('送料無料')).toBeInTheDocument();
    expect(screen.getByText('その他費用 600円')).toBeInTheDocument();
  });
});

describe('値引き（issue #50）', () => {
  /** 値引きを指定する。createProduct の引数に展開して渡す。 */
  const withDiscount = (discount: number | null) => ({ discount });

  it.each(['grid', 'list'] as const)('値引きがある場合（%s）、金額は値引き後の金額（送料込み。issue #70）だけを表示し、値引き前の金額と値引きの額は表示しない', (layout) => {
    render(<ProductCard product={createProduct({ price: 5000, shippingFee: 800, ...withDiscount(500) })} today={today} onSelect={vi.fn()} layout={layout} />);

    expect(screen.getByText('5,300円')).toBeInTheDocument();
    expect(screen.queryByText('5,000円')).not.toBeInTheDocument();
    expect(screen.queryByText(/(^|[^,\d])500円/)).not.toBeInTheDocument();
    expect(screen.queryByText(/値引き/)).not.toBeInTheDocument();
  });

  it.each(['grid', 'list'] as const)('値引きが金額を超える場合（%s。送料までポイントで払った場合）、金額を「0円」と表示する', (layout) => {
    render(<ProductCard product={createProduct({ price: 1000, shippingFee: 800, ...withDiscount(1800) })} today={today} onSelect={vi.fn()} layout={layout} />);

    expect(screen.getByText('0円')).toBeInTheDocument();
    expect(screen.queryByText(/-/)).not.toBeInTheDocument();
  });

  it('値引きが金額と同じ場合（送料なし）、金額を「0円」と表示する', () => {
    render(<ProductCard product={createProduct({ price: 1000, shippingFee: null, ...withDiscount(1000) })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('0円')).toBeInTheDocument();
  });

  it('値引きがあっても、送料の表示は今までどおり送料の額で示す（「送料800円を含む」。issue #70）', () => {
    render(<ProductCard product={createProduct({ price: 5000, shippingFee: 800, ...withDiscount(500) })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('送料800円を含む')).toBeInTheDocument();
  });

  it.each([
    ['null', null],
    ['0 円', 0],
  ])('値引きが %s の場合、今までどおり金額（送料込み。issue #70）を表示する', (_label, discount) => {
    render(<ProductCard product={createProduct({ price: 5000, ...withDiscount(discount) })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('5,800円')).toBeInTheDocument();
  });

  it('金額が未入力の場合、今までどおり「金額未入力」と表示する', () => {
    render(<ProductCard product={createProduct({ price: null, ...withDiscount(null) })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('金額未入力')).toBeInTheDocument();
  });
});

describe('開催日時と終了日時（PR #30 のレビュー）', () => {
  const eventProduct = (overrides: Partial<ProductResponse> = {}) =>
    createProduct({ eventStartsAt: '2026-11-20T09:00:00.000Z', eventEndsAt: '2026-11-20T12:00:00.000Z', ...overrides });

  it('カードを並べる形式（既定）では、開催日時と終了日時を「開催 11/20 18:00〜21:00」と表示する', () => {
    render(<ProductCard product={eventProduct()} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('開催 11/20 18:00〜21:00')).toBeInTheDocument();
    expect(screen.queryByText(/約3時間/)).not.toBeInTheDocument();
  });

  it('スマートフォンの幅のリスト形式（layout が list）では、開催期間を「開催 約3時間」と表示し、日時は表示しない', () => {
    render(<ProductCard product={eventProduct()} today={today} onSelect={vi.fn()} layout="list" />);

    expect(screen.getByText('開催 約3時間')).toBeInTheDocument();
    expect(screen.queryByText(/18:00/)).not.toBeInTheDocument();
  });

  it.each([
    ['開催日時だけ', { eventEndsAt: null }],
    ['終了日時だけ', { eventStartsAt: null }],
  ])('%sの場合、どちらの形式でも開催の表示を出さない', (_label, overrides) => {
    const { unmount } = render(<ProductCard product={eventProduct(overrides)} today={today} onSelect={vi.fn()} />);
    expect(screen.queryByText(/^開催 /)).not.toBeInTheDocument();
    unmount();

    render(<ProductCard product={eventProduct(overrides)} today={today} onSelect={vi.fn()} layout="list" />);
    expect(screen.queryByText(/^開催 /)).not.toBeInTheDocument();
  });

  it('開催日時と終了日時がない場合、開催の表示を出さない', () => {
    render(<ProductCard product={createProduct()} today={today} onSelect={vi.fn()} />);

    expect(screen.queryByText(/^開催 /)).not.toBeInTheDocument();
  });
});

describe('商品の画像（issue #41）', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('画像がある場合、画像を表示し、共通のアイコンは表示しない', () => {
    const { container } = render(
      <ProductCard product={createProduct({ imageUrl: '/api/products/product-1/image?v=abc' })} today={today} onSelect={vi.fn()} />,
    );

    const image = container.querySelector('.product-card-thumbnail img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('src', '/api/products/product-1/image?v=abc');
    expect(container.querySelector('.product-card-placeholder')).toBeNull();
  });

  it('画像は、切らずに枠の中に収める表示のクラスを付ける', () => {
    const { container } = render(
      <ProductCard product={createProduct({ imageUrl: '/api/products/product-1/image?v=abc' })} today={today} onSelect={vi.fn()} />,
    );

    expect(container.querySelector('.product-card-thumbnail img')).toHaveClass('product-card-image');
  });

  it('画像があっても、ステータスを表示する', () => {
    render(<ProductCard product={createProduct({ imageUrl: '/api/products/product-1/image?v=abc' })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('予約済')).toBeInTheDocument();
  });

  it('画像がない場合、共通のアイコンを表示する', () => {
    const { container } = render(<ProductCard product={createProduct({ imageUrl: null })} today={today} onSelect={vi.fn()} />);

    expect(container.querySelector('.product-card-thumbnail img')).toBeNull();
    expect(container.querySelector('.product-card-placeholder')).not.toBeNull();
  });

  it('画像を読み込めなかった場合、共通のアイコンに切り替える', () => {
    const { container } = render(
      <ProductCard product={createProduct({ imageUrl: '/api/products/product-1/image?v=abc' })} today={today} onSelect={vi.fn()} />,
    );

    fireEvent.error(container.querySelector('.product-card-thumbnail img') as HTMLImageElement);

    expect(container.querySelector('.product-card-thumbnail img')).toBeNull();
    expect(container.querySelector('.product-card-placeholder')).not.toBeNull();
  });

  it('画面を /waders/ で開いている場合、画像は /waders の下の API から読む（issue #39）', () => {
    window.history.replaceState(null, '', '/waders/');
    const { container } = render(
      <ProductCard product={createProduct({ imageUrl: '/api/products/product-1/image?v=abc' })} today={today} onSelect={vi.fn()} />,
    );

    expect(container.querySelector('.product-card-thumbnail img')).toHaveAttribute('src', '/waders/api/products/product-1/image?v=abc');
  });
});

describe('ステータス「キャンセル」の見せ方（issue #57）', () => {
  /** キャンセル（issue #57）。実装の前でも型チェックを通すため、文字列から変換して使う。 */
  const CANCELED_STATUS = 'canceled' as string as ProductResponse['status'];

  it.each(['grid', 'list'] as const)(
    'キャンセルの商品（%s）は、キャンセルの見た目のクラスを付け、未購入・購入済の見た目にはせず、ステータスを「キャンセル」と表示する',
    (layout) => {
      const { container } = render(<ProductCard product={createProduct({ status: CANCELED_STATUS })} today={today} onSelect={vi.fn()} layout={layout} />);

      const card = container.querySelector('article');
      expect(card).toHaveClass('product-card--canceled');
      expect(card).not.toHaveClass('product-card--unpurchased');
      expect(card).not.toHaveClass('product-card--purchased');
      expect(container.querySelector('.product-card-status')).toHaveTextContent(/^キャンセル$/);
    },
  );

  it('キャンセル可だった商品をキャンセルにした場合も、「予約済（キャンセル可）」ではなくキャンセルとして表示する', () => {
    const { container } = render(
      <ProductCard product={createProduct({ status: CANCELED_STATUS, cancelable: true })} today={today} onSelect={vi.fn()} />,
    );

    expect(container.querySelector('article')).toHaveClass('product-card--canceled');
    expect(container.querySelector('article')).not.toHaveClass('product-card--cancelable');
    expect(container.querySelector('.product-card-status')).toHaveTextContent(/^キャンセル$/);
  });

  it('キャンセルの商品にも、画像があれば画像を表示し、商品名はそのまま表示する', () => {
    const { container } = render(
      <ProductCard
        product={createProduct({ status: CANCELED_STATUS, imageUrl: '/api/products/product-1/image?v=abc' })}
        today={today}
        onSelect={vi.fn()}
      />,
    );

    expect(container.querySelector('.product-card-thumbnail img')).toHaveClass('product-card-image');
    expect(screen.getByText('オリジナルキャラクター シュガー ver.')).toBeInTheDocument();
  });

  it('キャンセルの商品には、受注期限が近くても ⚠️ を付けず、受注期限も表示しない', () => {
    render(<ProductCard product={createProduct({ status: CANCELED_STATUS, orderDeadline: '2026-11-20' })} today={today} onSelect={vi.fn()} />);

    expect(screen.queryByText(/⚠️/)).not.toBeInTheDocument();
    expect(screen.queryByText(/受注期限/)).not.toBeInTheDocument();
  });
});

describe('カード・リストの金額を送料込みにする（issue #70）', () => {
  it.each(['grid', 'list'] as const)('送料が 1 円以上の場合（%s）、金額に送料を足して表示し、「送料660円を含む」と書く', (layout) => {
    render(<ProductCard product={createProduct({ price: 2500, shippingFee: 660 })} today={today} onSelect={vi.fn()} layout={layout} />);

    expect(screen.getByText('3,160円')).toBeInTheDocument();
    expect(screen.getByText('送料660円を含む')).toBeInTheDocument();
    expect(screen.queryByText('2,500円')).not.toBeInTheDocument();
    expect(screen.queryByText('送料 660円')).not.toBeInTheDocument();
  });

  it('送料が 1 円の場合も、「送料1円を含む」と書く', () => {
    render(<ProductCard product={createProduct({ price: 2500, shippingFee: 1 })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('2,501円')).toBeInTheDocument();
    expect(screen.getByText('送料1円を含む')).toBeInTheDocument();
  });

  it.each([
    ['未入力', null],
    ['0 円', 0],
  ])('送料が %s の場合、金額だけを表示し、今までどおり「送料無料」と書く', (_label, shippingFee) => {
    render(<ProductCard product={createProduct({ price: 2500, shippingFee })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('2,500円')).toBeInTheDocument();
    expect(screen.getByText('送料無料')).toBeInTheDocument();
    expect(screen.queryByText(/を含む/)).not.toBeInTheDocument();
  });

  it('値引きがある場合、金額＋送料−値引きを表示する', () => {
    render(<ProductCard product={createProduct({ price: 5000, shippingFee: 660, discount: 1000 })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('4,660円')).toBeInTheDocument();
    expect(screen.getByText('送料660円を含む')).toBeInTheDocument();
  });

  it('値引きが金額と送料の合計と同じ場合、「0円」と表示する', () => {
    render(<ProductCard product={createProduct({ price: 1000, shippingFee: 800, discount: 1800 })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('0円')).toBeInTheDocument();
  });

  it('手数料・交通費（見込）・その他費用は金額に含めず、今までどおり別に示す', () => {
    render(
      <ProductCard product={createProduct({ price: 8800, shippingFee: 800, handlingFee: 330, travelExpense: 2000 })} today={today} onSelect={vi.fn()} />,
    );

    expect(screen.getByText('9,600円')).toBeInTheDocument();
    expect(screen.getByText('手数料 330円')).toBeInTheDocument();
    expect(screen.getByText('交通費（見込） 2,000円')).toBeInTheDocument();
  });

  it('金額が未入力の場合、送料があっても「金額未入力」だけを表示し、送料の文言は出さない', () => {
    render(<ProductCard product={createProduct({ price: null, shippingFee: 800 })} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('金額未入力')).toBeInTheDocument();
    expect(screen.queryByText(/送料/)).not.toBeInTheDocument();
  });
});

describe('カード・リストの金額を下にそろえる（issue #70）', () => {
  it.each(['grid', 'list'] as const)(
    '金額の行（%s）は、費用・開催日時・受注期限の行より後の、本文の最後の行に置く',
    (layout) => {
      const { container } = render(
        <ProductCard
          product={createProduct({
            status: 'considering',
            orderDeadline: '2026-11-20',
            handlingFee: 330,
            eventStartsAt: '2026-11-20T09:00:00.000Z',
            eventEndsAt: '2026-11-20T12:00:00.000Z',
          })}
          today={today}
          onSelect={vi.fn()}
          layout={layout}
        />,
      );

      const body = container.querySelector('.product-card-body');
      expect(body?.lastElementChild).toHaveClass('product-card-price');
      expect(body?.lastElementChild).toHaveTextContent('25,000円');
    },
  );
});
