// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProductCard } from '../../../client/components/ProductCard.tsx';
import type { ProductResponse } from '../../../shared/productContract.ts';

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
    category: null,
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
