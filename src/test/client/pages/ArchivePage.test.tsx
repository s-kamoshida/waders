// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchivePage } from '../../../client/pages/ArchivePage.tsx';
import { YEAR_MODE_STORAGE_KEY } from '../../../client/pages/ProductListPage.tsx';
import type { ProductListItem } from '../../../shared/productContract.ts';
import { stubFetchRoutes } from '../testFetchStub.ts';

/** 日本時間 2026-11-17 12:00。 */
const currentTime = new Date('2026-11-17T03:00:00.000Z');

let createdCount = 0;

/** テスト用の商品を作る。 */
function createProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  createdCount += 1;
  const createdAt = new Date(Date.UTC(2026, 5, 1, 0, createdCount)).toISOString();
  return {
    id: `product-${createdCount}`,
    name: `商品 ${createdCount}`,
    releaseMonth: '2026-10',
    status: 'purchased',
    cancelable: false,
    price: null,
    shippingFee: null,
    orderDeadline: null,
    url: null,
    category: null,
    createdAt,
    updatedAt: createdAt,
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

describe('アーカイブの表示', () => {
  it('発売月が当月より前の商品だけを、新しい月から順に、見出し（実績の集計）の下に表示する', async () => {
    const products = [
      createProduct({ name: '9月に届いた商品', releaseMonth: '2026-09', price: 17600, shippingFee: 900 }),
      createProduct({ name: '10月に届いた商品', releaseMonth: '2026-10', price: 22000 }),
      createProduct({ name: '今月の商品', releaseMonth: '2026-11', status: 'reserved' }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ArchivePage currentTime={currentTime} />);

    const october = await screen.findByRole('region', { name: '2026/10' });
    expect(within(october).getByText('10月に届いた商品')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2026\/10/ })).toHaveTextContent('1個（合計 22,000円）');
    expect(screen.getByRole('button', { name: /2026\/09/ })).toHaveTextContent('1個（合計 18,500円）');
    expect(screen.queryByText('今月の商品')).not.toBeInTheDocument();
    const monthLabels = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(monthLabels).toEqual(['2026/10', '2026/09']);
  });

  it('アーカイブされた商品がない場合、「アーカイブされた商品はありません」と表示する', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ releaseMonth: '2026-12' })] } }) });

    render(<ArchivePage currentTime={currentTime} />);

    expect(await screen.findByText('アーカイブされた商品はありません')).toBeInTheDocument();
  });

  it('リストで選んだ年のまとめ方（年度）を使う', async () => {
    localStorage.setItem(YEAR_MODE_STORAGE_KEY, 'fiscal');
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ releaseMonth: '2026-03' })] } }) });

    render(<ArchivePage currentTime={currentTime} />);

    expect(await screen.findByRole('button', { name: /^FY25/ })).toBeInTheDocument();
  });

  it('読み込みに失敗した場合、失敗したことを表示する', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } }) });

    render(<ArchivePage currentTime={currentTime} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('商品の一覧を読み込めませんでした。');
  });
});

describe('アーカイブされた商品の編集とリストに戻す', () => {
  it('商品を押した場合、編集のモーダルを開き、発売月は変更できず、「リストに戻す」ボタンがある', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '届いた商品' })] } }) });
    render(<ArchivePage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /届いた商品/ }));

    const dialog = screen.getByRole('dialog', { name: '商品を編集' });
    expect(within(dialog).getByLabelText('発売月')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'リストに戻す' })).toBeInTheDocument();
  });

  it('「リストに戻す」で新しい発売月を指定して戻した場合、一覧を読み込み直し、アーカイブから消える', async () => {
    const archivedProduct = createProduct({ id: 'archived-1', name: '延期された商品', status: 'purchased' });
    let products = [archivedProduct];
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'POST /api/products/archived-1/restore': (body) => {
        const releaseMonth = (body as { releaseMonth: string }).releaseMonth;
        products = [{ ...archivedProduct, status: 'reserved', releaseMonth }];
        return { body: products[0] };
      },
    });
    render(<ArchivePage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /延期された商品/ }));
    await userEvent.click(screen.getByRole('button', { name: 'リストに戻す' }));
    const restoreDialog = screen.getByRole('dialog', { name: 'リストに戻す' });
    await userEvent.click(within(restoreDialog).getByRole('button', { name: '戻す' }));

    expect(await screen.findByText('アーカイブされた商品はありません')).toBeInTheDocument();
    expect(requests.find((recorded) => recorded.method === 'POST')).toMatchObject({
      path: '/api/products/archived-1/restore',
      body: { releaseMonth: '2026-11' },
    });
    await waitFor(() => expect(requests.filter((recorded) => recorded.method === 'GET')).toHaveLength(2));
  });
});
