// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProductCard } from '../../../client/components/ProductCard.tsx';
import type { ProductResponse } from '../../../shared/productContract.ts';
import type { CategoryResponse } from '../../../shared/categoryContract.ts';

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
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProductCard', () => {
  it('商品名・ステータス・金額・送料を表示する', () => {
    render(<ProductCard product={createProduct()} today={today} onSelect={vi.fn()} />);

    expect(screen.getByText('オリジナルキャラクター シュガー ver.')).toBeInTheDocument();
    expect(screen.getByText('予約済')).toBeInTheDocument();
    expect(screen.getByText('24,200円')).toBeInTheDocument();
    expect(screen.getByText('送料 800円')).toBeInTheDocument();
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

  it('送料を使わないカテゴリーの商品でも、送料が保存されている場合は表示する', () => {
    render(<ProductCard product={ticketProduct({ shippingFee: 800 })} today={today} onSelect={vi.fn()} categories={categories} />);

    expect(screen.getByText('送料 800円')).toBeInTheDocument();
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
