// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../client/App.tsx';
import type { ProductListItem } from '../../shared/productContract.ts';
import { stubFetchRoutes } from './testFetchStub.ts';

/** 日本時間 2026-11-17 12:00。 */
const currentTime = new Date('2026-11-17T03:00:00.000Z');

/** テスト用の商品を作る。 */
function createProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'product-1',
    name: '商品',
    releaseMonth: '2026-12',
    status: 'reserved',
    cancelable: false,
    price: null,
    shippingFee: null,
    orderDeadline: null,
    url: null,
    category: null,
    maker: null,
    note: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    deliveryConfirmationPending: false,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('画面を開いた場合、アプリ名「Waders」を見出しとして表示する', () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [] } }) });

    render(<App currentTime={currentTime} />);

    expect(screen.getByRole('heading', { name: 'Waders' })).toBeInTheDocument();
  });

  it('最初はリストのタブを表示し、アーカイブのタブに切り替えられる（issue #9）', async () => {
    stubFetchRoutes({
      'GET /api/products': () => ({
        body: { products: [createProduct({ name: 'リストの商品' }), createProduct({ id: 'product-2', name: 'アーカイブの商品', releaseMonth: '2026-10', status: 'purchased' })] },
      }),
    });
    render(<App currentTime={currentTime} />);

    expect(screen.getByRole('tab', { name: 'リスト' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('リストの商品')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'アーカイブ' }));

    expect(screen.getByRole('tab', { name: 'アーカイブ' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('アーカイブの商品')).toBeInTheDocument();
    expect(screen.queryByText('リストの商品')).not.toBeInTheDocument();
  });

  it('延期の確認待ちの商品がある場合、開いたときに延期の確認を表示し、「あとで」で閉じる（issue #9）', async () => {
    stubFetchRoutes({
      'GET /api/products': () => ({
        body: { products: [createProduct({ name: '確認待ちの商品', releaseMonth: '2026-10', status: 'purchased', deliveryConfirmationPending: true })] },
      }),
    });
    render(<App currentTime={currentTime} />);

    expect(await screen.findByRole('dialog', { name: '発売月を過ぎた予約商品の確認' })).toHaveTextContent('確認待ちの商品');

    await userEvent.click(screen.getByRole('button', { name: 'あとで' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('延期の確認待ちの商品がない場合、延期の確認を表示しない（issue #9）', async () => {
    const { requests } = stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct()] } }) });
    render(<App currentTime={currentTime} />);

    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    await screen.findByText('商品');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('延期の確認に回答した場合、確認を閉じ、表示中の一覧を読み込み直す（issue #9）', async () => {
    const awaitingProduct = createProduct({ name: '延期された商品', releaseMonth: '2026-10', status: 'purchased', deliveryConfirmationPending: true });
    let products = [awaitingProduct];
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'POST /api/products/product-1/delivery-confirmation': () => {
        products = [{ ...awaitingProduct, status: 'reserved', releaseMonth: '2026-11', deliveryConfirmationPending: false }];
        return { body: products[0] };
      },
    });
    render(<App currentTime={currentTime} />);
    await screen.findByRole('dialog', { name: '発売月を過ぎた予約商品の確認' });
    const getCountBeforeAnswer = requests.filter((recorded) => recorded.method === 'GET').length;

    await userEvent.click(screen.getByLabelText('延期された'));
    await userEvent.click(screen.getByRole('button', { name: '回答を保存' }));

    expect(await screen.findByText('延期された商品')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requests.filter((recorded) => recorded.method === 'GET').length).toBeGreaterThan(getCountBeforeAnswer);
  });
});
