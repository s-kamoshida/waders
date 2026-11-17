// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductListPage, YEAR_MODE_STORAGE_KEY } from '../../../client/pages/ProductListPage.tsx';
import type { ProductResponse } from '../../../shared/productContract.ts';
import { stubFetchRoutes } from '../testFetchStub.ts';

/** 日本時間 2026-11-17 12:00。 */
const currentTime = new Date('2026-11-17T03:00:00.000Z');

let createdCount = 0;

/** テスト用の商品を作る。 */
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
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('一覧の表示', () => {
  it('読み込んだ商品を、年と月の見出し（個数と合計金額の見込み）の下に表示し、0 件の月も表示する', async () => {
    const products = [
      createProduct({ name: '11月の予約商品', releaseMonth: '2026-11', price: 19800, shippingFee: 0 }),
      createProduct({ name: '1月の予約商品', releaseMonth: '2027-01', price: 30800, shippingFee: 800 }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ProductListPage currentTime={currentTime} />);

    const november = await screen.findByRole('region', { name: '2026/11' });
    expect(within(november).getByText('11月の予約商品')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2026\/11/ })).toHaveTextContent('1個（合計 19,800円見込）');
    expect(within(screen.getByRole('region', { name: '2026/12' })).getByText('商品はありません')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '2027/01' })).getByText('1月の予約商品')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^2026年/ })).toHaveTextContent('1個（合計 19,800円見込）');
    expect(screen.getByRole('button', { name: /^2027年/ })).toHaveTextContent('1個（合計 31,600円見込）');
  });

  it('商品が 1 件もない場合、当月を「商品はありません」として表示する', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [] } }) });

    render(<ProductListPage currentTime={currentTime} />);

    const november = await screen.findByRole('region', { name: '2026/11' });
    expect(within(november).getByText('商品はありません')).toBeInTheDocument();
  });

  it('読み込みに失敗した場合、失敗したことを表示する', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } }) });

    render(<ProductListPage currentTime={currentTime} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('商品の一覧を読み込めませんでした。');
  });
});

describe('アーカイブとの振り分け（issue #9）', () => {
  it('発売月が当月より前の商品は、リストに表示しない', async () => {
    const products = [
      createProduct({ name: 'アーカイブされた商品', releaseMonth: '2026-10', status: 'purchased' }),
      createProduct({ name: '今月の商品', releaseMonth: '2026-11' }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ProductListPage currentTime={currentTime} />);

    expect(await screen.findByText('今月の商品')).toBeInTheDocument();
    expect(screen.queryByText('アーカイブされた商品')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '2026/10' })).not.toBeInTheDocument();
  });
});

describe('折りたたみ', () => {
  it('月の見出しを押した場合、その月の商品を隠し、もう一度押すと表示する', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '11月の商品' })] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    const monthHeading = await screen.findByRole('button', { name: /2026\/11/ });
    expect(monthHeading).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(monthHeading);

    expect(monthHeading).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('11月の商品')).not.toBeInTheDocument();

    await userEvent.click(monthHeading);

    expect(screen.getByText('11月の商品')).toBeInTheDocument();
  });

  it('年の見出しを押した場合、その年の月をすべて隠す', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '11月の商品' })] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    const yearHeading = await screen.findByRole('button', { name: /^2026年/ });

    await userEvent.click(yearHeading);

    expect(yearHeading).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: '2026/11' })).not.toBeInTheDocument();
  });
});

describe('暦年と年度の切り替え', () => {
  it('「年度」に切り替えた場合、年の見出しを FY で表示し、次に開いたときも年度で表示する', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [] } }) });
    const { unmount } = render(<ProductListPage currentTime={currentTime} />);
    await screen.findByRole('button', { name: /^2026年/ });

    await userEvent.click(screen.getByRole('radio', { name: '年度' }));

    expect(screen.getByRole('button', { name: /^FY26/ })).toBeInTheDocument();
    expect(localStorage.getItem(YEAR_MODE_STORAGE_KEY)).toBe('fiscal');

    unmount();
    render(<ProductListPage currentTime={currentTime} />);

    expect(await screen.findByRole('button', { name: /^FY26/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '年度' })).toBeChecked();
  });

  it('保存されている値が不正な場合、暦年で表示する', async () => {
    localStorage.setItem(YEAR_MODE_STORAGE_KEY, 'unknown');
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [] } }) });

    render(<ProductListPage currentTime={currentTime} />);

    expect(await screen.findByRole('button', { name: /^2026年/ })).toBeInTheDocument();
  });
});

describe('追加・編集のモーダル', () => {
  it('＋ボタンを押した場合、発売月が当月の追加のモーダルを開く', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByRole('region', { name: '2026/11' });

    await userEvent.click(screen.getByRole('button', { name: '商品を追加' }));

    const dialog = screen.getByRole('dialog', { name: '商品を追加' });
    expect(within(dialog).getByLabelText('発売月')).toHaveValue('2026-11');
  });

  it('商品を押した場合、その商品の編集のモーダルを開く', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '編集する商品' })] } }) });
    render(<ProductListPage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /編集する商品/ }));

    const dialog = screen.getByRole('dialog', { name: '商品を編集' });
    expect(within(dialog).getByLabelText('商品名')).toHaveValue('編集する商品');
  });

  it('保存した場合、モーダルを閉じ、一覧を読み込み直して表示する', async () => {
    let products = [createProduct({ name: '既存の商品' })];
    const added = createProduct({ name: '追加した商品' });
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'POST /api/products': () => {
        products = [...products, added];
        return { status: 201, body: added };
      },
    });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('既存の商品');

    await userEvent.click(screen.getByRole('button', { name: '商品を追加' }));
    await userEvent.type(screen.getByLabelText('商品名'), '追加した商品');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('追加した商品')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(requests.filter((recorded) => recorded.method === 'GET')).toHaveLength(2));
  });
});
