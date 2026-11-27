// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchivePage } from '../../../client/pages/ArchivePage.tsx';
import { CATEGORY_FILTER_STORAGE_KEY } from '../../../client/pages/ProductListPage.tsx';
import type { ProductListItem } from '../../../shared/productContract.ts';
import { stubFetchRoutes } from '../testFetchStub.ts';

/** 値引きなし（issue #50）。既存の商品・テストの既定の値として、フィクスチャに展開して加える。 */
const NO_DISCOUNT = { discount: null } as const;
/** 画像なし（issue #51 の画像の種類）。項目ができる前でも型に合うよう、フィクスチャには展開して加える。 */
const NO_IMAGE_KIND = { imageKind: null } as const;

// 画像の縮小（canvas）は jsdom では動かないため、縮小した結果を決まった値にする（issue #41）
vi.mock('../../../client/productImagePreparation.ts', () => ({
  prepareProductImage: vi.fn(async () => ({ data: 'PREPARED', width: 800, height: 600 })),
  drawProductImagePreview: vi.fn(),
}));

/**
 * 以前（issue #8〜#58）に暦年・年度の選択を覚えていた、ブラウザの保存領域のキー。
 * issue #58 で切り替えをなくした後も、古い端末にはこの値が残っているため、実装の定数ではなく値そのものを使う。
 */
const LEGACY_YEAR_MODE_STORAGE_KEY = 'waders.yearMode';

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
    deliveryConfirmationPending: false,
    cardImagePending: false,
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

  it('年をまたぐ商品がある場合、1 月〜12 月の暦年でまとめ、「2026年」「2025年」と表記する（issue #58）', async () => {
    const products = [
      createProduct({ releaseMonth: '2026-04', price: 30000 }),
      createProduct({ releaseMonth: '2026-03', price: 20000, shippingFee: 500 }),
      createProduct({ releaseMonth: '2025-12', price: 10000 }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ArchivePage currentTime={currentTime} />);

    await screen.findByRole('region', { name: '2026/04' });
    expect(screen.getByRole('button', { name: /^2026年/ })).toHaveTextContent('2個（合計 50,500円）');
    expect(screen.getByRole('button', { name: /^2025年/ })).toHaveTextContent('1個（合計 10,000円）');
    expect(screen.queryByRole('button', { name: /^FY/ })).not.toBeInTheDocument();
  });

  it('端末に年度（fiscal）を選んだ記録が残っている場合も、年の見出しを暦年で表示し、個数と合計金額は暦年で数える（issue #58）', async () => {
    localStorage.setItem(LEGACY_YEAR_MODE_STORAGE_KEY, 'fiscal');
    const products = [
      createProduct({ releaseMonth: '2026-04', price: 30000 }),
      createProduct({ releaseMonth: '2026-03', price: 20000, shippingFee: 500 }),
      createProduct({ releaseMonth: '2025-12', price: 10000 }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ArchivePage currentTime={currentTime} />);

    await screen.findByRole('region', { name: '2026/04' });
    expect(screen.getByRole('button', { name: /^2026年/ })).toHaveTextContent('2個（合計 50,500円）');
    expect(screen.getByRole('button', { name: /^2025年/ })).toHaveTextContent('1個（合計 10,000円）');
    expect(screen.queryByRole('button', { name: /^FY/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^2026\/03/ })).toHaveTextContent('1個（合計 20,500円）');
  });

  it('月の見出しに追加ボタンを表示しない（issue #16）', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ releaseMonth: '2026-10' })] } }) });

    render(<ArchivePage currentTime={currentTime} />);

    await screen.findByRole('region', { name: '2026/10' });
    expect(screen.queryByRole('button', { name: /に商品を追加$/ })).not.toBeInTheDocument();
  });

  it('読み込みに失敗した場合、失敗したことを表示する', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } }) });

    render(<ArchivePage currentTime={currentTime} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('商品の一覧を読み込めませんでした。');
  });
});

describe('カテゴリーの絞り込み（issue #10）', () => {
  it('リストで選んだカテゴリーでアーカイブも絞り込み、見出しの集計も絞り込んだ商品で数える', async () => {
    localStorage.setItem(CATEGORY_FILTER_STORAGE_KEY, JSON.stringify({ categoryIds: ['scale'], includesUncategorized: false }));
    stubFetchRoutes({
      'GET /api/products': () => ({
        body: {
          products: [
            createProduct({ name: 'スケールの商品', categoryId: 'scale', categoryName: 'スケールフィギュア', price: 20000 }),
            createProduct({ name: '可動の商品', categoryId: 'action', categoryName: '可動フィギュア', price: 10000 }),
          ],
        },
      }),
    });

    render(<ArchivePage currentTime={currentTime} />);

    expect(await screen.findByText('スケールの商品')).toBeInTheDocument();
    expect(screen.queryByText('可動の商品')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^2026\/10 / })).toHaveTextContent('1個（合計 20,000円）');
    expect(screen.getByRole('button', { name: 'カテゴリー: スケールフィギュア' })).toBeInTheDocument();
  });
});

describe('アーカイブされた商品の編集とリストに戻す', () => {
  it('商品を押して詳細画面の「編集」を押した場合、編集のモーダルを開き、発売月は変更できず、「リストに戻す」ボタンがある（issue #52 で詳細画面を挟む）', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '届いた商品' })] } }) });
    render(<ArchivePage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /届いた商品/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: '商品の詳細' })).getByRole('button', { name: '編集' }));

    const dialog = screen.getByRole('dialog', { name: '商品を編集' });
    expect(within(dialog).getByLabelText('発売月')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'リストに戻す' })).toBeInTheDocument();
  });

  it('詳細画面の「リストに戻す」で新しい発売月を指定して戻した場合、一覧を読み込み直し、アーカイブから消える', async () => {
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
    await userEvent.click(within(screen.getByRole('dialog', { name: '商品の詳細' })).getByRole('button', { name: 'リストに戻す' }));
    expect(screen.queryByRole('dialog', { name: '商品の詳細' })).not.toBeInTheDocument();
    const restoreDialog = screen.getByRole('dialog', { name: 'リストに戻す' });
    await userEvent.click(within(restoreDialog).getByRole('button', { name: '戻す' }));

    expect(await screen.findByText('アーカイブされた商品はありません')).toBeInTheDocument();
    expect(requests.find((recorded) => recorded.method === 'POST')).toMatchObject({
      path: '/api/products/archived-1/restore',
      body: { releaseMonth: '2026-11' },
    });
    await waitFor(() => expect(requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products')).toHaveLength(2));
  });
});

describe('ドラッグアンドドロップ（issue #13）', () => {
  it('アーカイブの商品はドラッグできず、落としても移動しない', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({
        body: { products: [createProduct({ name: '9月の商品', releaseMonth: '2026-09' }), createProduct({ name: '10月の商品', releaseMonth: '2026-10' })] },
      }),
    });
    render(<ArchivePage currentTime={currentTime} />);
    const card = (await screen.findByRole('button', { name: /9月の商品/ })).closest('article');
    if (card === null) throw new Error('カードが見つかりません');

    expect(card).not.toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(card);
    fireEvent.dragOver(screen.getByRole('region', { name: '2026/10' }));
    fireEvent.drop(screen.getByRole('region', { name: '2026/10' }));

    expect(requests.filter((recorded) => recorded.method === 'PATCH')).toEqual([]);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});

describe('スマートフォンの幅でのリスト形式（issue #15）', () => {
  /** 横幅 600px 以下として扱うように、画面の幅を偽装する。 */
  function stubPhoneWidth(isPhoneWidth: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 600px)' ? isPhoneWidth : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  /** 月の中で商品を並べている要素を返す。 */
  function findProductContainer(monthLabel: string): Element | null {
    return screen.getByRole('region', { name: monthLabel }).querySelector('.product-list, .product-grid');
  }

  it('横幅 600px 以下の場合、アーカイブの商品も 1 行に 1 件のリスト形式で表示し、未購入の見せ方もカードと同じにする', async () => {
    stubPhoneWidth(true);
    const products = [
      createProduct({ name: '届いた商品', releaseMonth: '2026-10', status: 'purchased' }),
      createProduct({ name: '買わなかった商品', releaseMonth: '2026-10', status: 'unpurchased' }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ArchivePage currentTime={currentTime} />);
    await screen.findByText('届いた商品');

    expect(findProductContainer('2026/10')).toHaveClass('product-list');
    expect(screen.getByRole('button', { name: /届いた商品/ }).closest('article')).toHaveClass('product-card--purchased');
    expect(screen.getByRole('button', { name: /買わなかった商品/ }).closest('article')).toHaveClass('product-card--unpurchased');
  });

  it('横幅が 600px より広い場合、アーカイブも今までどおりカードを横に並べる（グリッド）', async () => {
    stubPhoneWidth(false);
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: 'PC の商品', releaseMonth: '2026-10' })] } }) });

    render(<ArchivePage currentTime={currentTime} />);
    await screen.findByText('PC の商品');

    expect(findProductContainer('2026/10')).toHaveClass('product-grid');
  });
});

describe('商品の画像を保存できなかった場合（issue #41）', () => {
  it('商品を保存できて画像を保存できなかった場合、モーダルを閉じ、画像を保存できなかったことを知らせる', async () => {
    const archivedProduct = createProduct({ id: 'archived-1', name: '届いた商品', status: 'purchased' });
    stubFetchRoutes({
      'GET /api/products': () => ({ body: { products: [archivedProduct] } }),
      'PUT /api/products/archived-1': () => ({ body: archivedProduct }),
      'PUT /api/products/archived-1/image': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'error' } } }),
    });
    render(<ArchivePage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /届いた商品/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: '商品の詳細' })).getByRole('button', { name: '編集' }));
    await userEvent.upload(screen.getByLabelText('画像'), new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('img', { name: '選んだ画像' });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('status')).toHaveTextContent('商品は保存しましたが、画像を保存できませんでした。');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('アーカイブの商品の詳細画面（issue #52）', () => {
  it('商品を押した場合、編集のモーダルではなく詳細画面を開き、詳細画面に「リストに戻す」がある', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '届いた商品' })] } }) });
    render(<ArchivePage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /届いた商品/ }));

    const detail = screen.getByRole('dialog', { name: '商品の詳細' });
    expect(within(detail).getByRole('button', { name: 'リストに戻す' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '商品を編集' })).not.toBeInTheDocument();
  });

  it('詳細画面の「編集」から編集のモーダルを開いて保存した場合、アーカイブに戻り（詳細画面は開かない）、一覧を読み込み直す', async () => {
    const archivedProduct = createProduct({ id: 'archived-1', name: '届いた商品' });
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products: [archivedProduct] } }),
      'PUT /api/products/archived-1': () => ({ body: archivedProduct }),
    });
    render(<ArchivePage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /届いた商品/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: '商品の詳細' })).getByRole('button', { name: '編集' }));
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products')).toHaveLength(2));
  });

  it('詳細画面でステータスを変えた場合、詳細画面は開いたまま、一覧を読み込み直す', async () => {
    const archivedProduct = createProduct({ id: 'archived-1', name: '届いた商品', status: 'purchased' });
    let products = [archivedProduct];
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'PATCH /api/products/archived-1/status': () => {
        products = [{ ...archivedProduct, status: 'unpurchased' }];
        return { body: products[0] };
      },
    });
    render(<ArchivePage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /届いた商品/ }));
    await userEvent.selectOptions(within(screen.getByRole('dialog', { name: '商品の詳細' })).getByRole('combobox', { name: 'ステータス' }), '未購入');

    await waitFor(() => expect(requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products')).toHaveLength(2));
    expect(screen.getByRole('dialog', { name: '商品の詳細' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /届いた商品/ }).closest('article')).toHaveClass('product-card--unpurchased'));
  });
});

describe('ステータス「キャンセル」の商品（issue #57）', () => {
  /** キャンセル（issue #57）。実装の前でも型チェックを通すため、文字列から変換して使う。 */
  const CANCELED_STATUS = 'canceled' as string as ProductListItem['status'];

  it('発売月が当月以降のキャンセルの商品も、アーカイブの発売月の位置に、キャンセルの見せ方で表示する', async () => {
    const products = [
      createProduct({ name: '来年のキャンセルした商品', releaseMonth: '2027-01', status: CANCELED_STATUS }),
      createProduct({ name: '今月のキャンセルした商品', releaseMonth: '2026-11', status: CANCELED_STATUS }),
      createProduct({ name: '10月に届いた商品', releaseMonth: '2026-10', status: 'purchased' }),
      createProduct({ name: '今月の予約済の商品', releaseMonth: '2026-11', status: 'reserved' }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ArchivePage currentTime={currentTime} />);

    const january = await screen.findByRole('region', { name: '2027/01' });
    expect(within(january).getByText('来年のキャンセルした商品')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '2026/11' })).getByText('今月のキャンセルした商品')).toBeInTheDocument();
    expect(screen.queryByText('今月の予約済の商品')).not.toBeInTheDocument();
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual(['2027/01', '2026/11', '2026/10']);
    const canceledCard = screen.getByRole('button', { name: /来年のキャンセルした商品/ }).closest('article');
    expect(canceledCard).toHaveClass('product-card--canceled');
    expect(within(canceledCard as HTMLElement).getByText('キャンセル')).toBeInTheDocument();
  });

  it('アーカイブの見出しの個数と合計金額に、キャンセルの商品を含めない', async () => {
    const products = [
      createProduct({ name: '届いた商品', releaseMonth: '2026-10', status: 'purchased', price: 22000, shippingFee: 800 }),
      createProduct({ name: 'キャンセルした商品', releaseMonth: '2026-10', status: CANCELED_STATUS, price: 18700, shippingFee: 600 }),
      createProduct({ name: '来年のキャンセルした商品', releaseMonth: '2027-01', status: CANCELED_STATUS, price: 9800 }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ArchivePage currentTime={currentTime} />);

    await screen.findByRole('region', { name: '2026/10' });
    expect(screen.getByRole('button', { name: /2026\/10/ })).toHaveTextContent('1個（合計 22,800円）');
    expect(screen.getByRole('button', { name: /2027\/01/ })).toHaveTextContent('0個（合計 0円）');
  });

  it('同じ月の中では、キャンセルの商品を未購入の後に並べる', async () => {
    const products = [
      createProduct({ name: 'キャンセルした商品', releaseMonth: '2026-10', status: CANCELED_STATUS }),
      createProduct({ name: '買わなかった商品', releaseMonth: '2026-10', status: 'unpurchased' }),
      createProduct({ name: '届いた商品', releaseMonth: '2026-10', status: 'purchased' }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ArchivePage currentTime={currentTime} />);

    const october = await screen.findByRole('region', { name: '2026/10' });
    const names = Array.from(october.querySelectorAll('.product-card-name')).map((element) => element.textContent);
    expect(names).toEqual(['届いた商品', '買わなかった商品', 'キャンセルした商品']);
  });

  it('発売月が当月以降のキャンセルの商品を、詳細画面の「リストに戻す」で戻した場合、一覧を読み込み直し、アーカイブから消える', async () => {
    const canceledProduct = createProduct({ id: 'canceled-1', name: 'キャンセルした商品', releaseMonth: '2027-01', status: CANCELED_STATUS });
    let products = [canceledProduct];
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'POST /api/products/canceled-1/restore': (body) => {
        const releaseMonth = (body as { releaseMonth: string }).releaseMonth;
        products = [{ ...canceledProduct, status: 'considering', releaseMonth }];
        return { body: products[0] };
      },
    });
    render(<ArchivePage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /キャンセルした商品/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: '商品の詳細' })).getByRole('button', { name: 'リストに戻す' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'リストに戻す' })).getByRole('button', { name: '戻す' }));

    expect(await screen.findByText('アーカイブされた商品はありません')).toBeInTheDocument();
    expect(requests.find((recorded) => recorded.method === 'POST')).toMatchObject({
      path: '/api/products/canceled-1/restore',
      body: { releaseMonth: '2027-01' },
    });
  });

  it('発売月が当月以降のキャンセルの商品を、詳細画面で検討中に変えた場合、一覧を読み込み直し、アーカイブから消える', async () => {
    const canceledProduct = createProduct({ id: 'canceled-1', name: 'キャンセルした商品', releaseMonth: '2027-01', status: CANCELED_STATUS });
    let products = [canceledProduct];
    stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'PATCH /api/products/canceled-1/status': () => {
        products = [{ ...canceledProduct, status: 'considering' }];
        return { body: products[0] };
      },
    });
    render(<ArchivePage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /キャンセルした商品/ }));
    await userEvent.selectOptions(within(screen.getByRole('dialog', { name: '商品の詳細' })).getByRole('combobox', { name: 'ステータス' }), '検討中');

    expect(await screen.findByText('アーカイブされた商品はありません')).toBeInTheDocument();
  });
});
