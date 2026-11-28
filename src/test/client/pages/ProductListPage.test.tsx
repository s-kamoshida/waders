// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORY_FILTER_STORAGE_KEY, ProductListPage } from '../../../client/pages/ProductListPage.tsx';
import type { ProductResponse } from '../../../shared/productContract.ts';
import { getFooterButton, getHeaderCloseButton } from '../dialogCloseButtonQueries.ts';
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
    expect(screen.getByRole('button', { name: /^2026\/11 / })).toHaveTextContent('1個（合計 19,800円見込）');
    expect(within(screen.getByRole('region', { name: '2026/12' })).getByRole('button', { name: '2026/12に商品を追加' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '2027/01' })).getByText('1月の予約商品')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^2026年/ })).toHaveTextContent('1個（合計 19,800円見込）');
    expect(screen.getByRole('button', { name: /^2027年/ })).toHaveTextContent('1個（合計 31,600円見込）');
  });

  it('商品が 1 件もない場合、当月を追加の空のカードだけで表示する（「商品はありません」の代わり。issue #68）', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [] } }) });

    render(<ProductListPage currentTime={currentTime} />);

    const november = await screen.findByRole('region', { name: '2026/11' });
    expect(within(november).getByRole('button', { name: '2026/11に商品を追加' })).toBeInTheDocument();
    expect(within(november).queryByText('商品はありません')).not.toBeInTheDocument();
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
    const monthHeading = await screen.findByRole('button', { name: /^2026\/11 / });
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

describe('年のまとめ方（issue #58 で暦年だけにした）', () => {
  it('一覧を開いた場合、ツールバーに暦年・年度の切り替えを表示しない', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [] } }) });

    render(<ProductListPage currentTime={currentTime} />);

    await screen.findByRole('button', { name: /^2026年/ });
    expect(screen.queryByRole('radiogroup', { name: '年のまとめ方' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '暦年' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '年度' })).not.toBeInTheDocument();
  });

  it('年をまたぐ商品がある場合、1 月〜12 月の暦年でまとめ、「2026年」「2027年」と表記する', async () => {
    const products = [
      createProduct({ releaseMonth: '2026-12', price: 10000 }),
      createProduct({ releaseMonth: '2027-03', price: 20000, shippingFee: 500 }),
      createProduct({ releaseMonth: '2027-04', price: 30000 }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ProductListPage currentTime={currentTime} />);

    await screen.findByRole('region', { name: '2026/12' });
    expect(screen.getByRole('button', { name: /^2026年/ })).toHaveTextContent('1個（合計 10,000円見込）');
    expect(screen.getByRole('button', { name: /^2027年/ })).toHaveTextContent('2個（合計 50,500円見込）');
    expect(screen.queryByRole('button', { name: /^FY/ })).not.toBeInTheDocument();
  });

  it('端末に年度（fiscal）を選んだ記録が残っている場合も、年の見出しを暦年で表示し、個数と合計金額は暦年で数える', async () => {
    localStorage.setItem(LEGACY_YEAR_MODE_STORAGE_KEY, 'fiscal');
    const products = [
      createProduct({ releaseMonth: '2026-12', price: 10000 }),
      createProduct({ releaseMonth: '2027-03', price: 20000, shippingFee: 500 }),
      createProduct({ releaseMonth: '2027-04', price: 30000 }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ProductListPage currentTime={currentTime} />);

    await screen.findByRole('region', { name: '2026/12' });
    expect(screen.getByRole('button', { name: /^2026年/ })).toHaveTextContent('1個（合計 10,000円見込）');
    expect(screen.getByRole('button', { name: /^2027年/ })).toHaveTextContent('2個（合計 50,500円見込）');
    expect(screen.queryByRole('button', { name: /^FY/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^2027\/03 / })).toHaveTextContent('1個（合計 20,500円見込）');
  });

  it('端末に不正な値が残っている場合、暦年で表示する', async () => {
    localStorage.setItem(LEGACY_YEAR_MODE_STORAGE_KEY, 'unknown');
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

  it('商品を押して詳細画面の「編集」を押した場合、その商品の編集のモーダルを開く（issue #52 で詳細画面を挟む）', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '編集する商品' })] } }) });
    render(<ProductListPage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /編集する商品/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: '商品の詳細' })).getByRole('button', { name: '編集' }));

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
    await waitFor(() => expect(requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products')).toHaveLength(2));
  });
});

describe('月ごとの追加ボタン（issue #16）', () => {
  it('月の追加のカードを押した場合、発売月がその月の追加のモーダルを開く（商品のない月も含む。issue #68 で見出しから並びの最後に移した）', async () => {
    stubFetchRoutes({
      'GET /api/products': () => ({ body: { products: [createProduct({ releaseMonth: '2027-02' })] } }),
    });
    render(<ProductListPage currentTime={currentTime} />);
    const january = await screen.findByRole('region', { name: '2027/01' });

    await userEvent.click(within(january).getByRole('button', { name: '2027/01に商品を追加' }));

    const dialog = screen.getByRole('dialog', { name: '商品を追加' });
    expect(within(dialog).getByLabelText('発売月')).toHaveValue('2027-01');
  });

  it('月を折りたたんだ場合、その月の追加のカードも隠す（issue #68。それまでは見出しの追加ボタンを折りたたんでも押せた）', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct()] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('商品 ' + String(createdCount));

    await userEvent.click(screen.getByRole('button', { name: /^2026\/11 / }));

    expect(screen.queryByRole('button', { name: '2026/11に商品を追加' })).not.toBeInTheDocument();
  });
});

describe('連続追加（issue #16）', () => {
  it('「保存して続けて追加」で保存した場合、モーダルを開いたまま、一覧を読み込み直して追加した商品を表示する', async () => {
    let products: ProductResponse[] = [];
    const added = createProduct({ name: '続けて追加した商品' });
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'POST /api/products': () => {
        products = [added];
        return { status: 201, body: added };
      },
    });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByRole('region', { name: '2026/11' });

    await userEvent.click(screen.getByRole('button', { name: '商品を追加' }));
    await userEvent.type(screen.getByLabelText('商品名'), '続けて追加した商品');
    await userEvent.click(screen.getByRole('button', { name: '保存方法を選ぶ' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: '保存して続けて追加' }));
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));

    expect(await screen.findByRole('button', { name: /続けて追加した商品/ })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '商品を追加' })).toBeInTheDocument();
    expect(requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products')).toHaveLength(2);
  });
});

describe('メーカーの候補（issue #18）', () => {
  it('追加のモーダルに、登録済みの商品（アーカイブを含む）のメーカーを、重複なく並べて候補として渡す', async () => {
    stubFetchRoutes({
      'GET /api/products': () => ({
        body: {
          products: [
            createProduct({ maker: 'メーカーB' }),
            createProduct({ maker: 'メーカーA' }),
            createProduct({ maker: 'メーカーB' }),
            createProduct({ maker: null }),
            createProduct({ maker: 'メーカーC', releaseMonth: '2026-09', status: 'purchased' }),
          ],
        },
      }),
    });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByRole('region', { name: '2026/11' });

    await userEvent.click(screen.getByRole('button', { name: '商品を追加' }));

    const makerInput = within(screen.getByRole('dialog', { name: '商品を追加' })).getByLabelText('メーカー');
    const suggestionList = document.getElementById(makerInput.getAttribute('list') ?? '');
    expect(Array.from(suggestionList?.querySelectorAll('option') ?? []).map((option) => option.value)).toEqual([
      'メーカーA',
      'メーカーB',
      'メーカーC',
    ]);
  });
});

describe('カテゴリーの絞り込み（issue #10）', () => {
  /** スケールフィギュア・可動フィギュア・未設定の 11 月の商品を返す。 */
  function createCategorizedProducts() {
    return [
      createProduct({ name: 'スケールの商品', categoryId: 'scale', categoryName: 'スケールフィギュア', price: 20000 }),
      createProduct({ name: '可動の商品', categoryId: 'action', categoryName: '可動フィギュア', price: 10000 }),
      createProduct({ name: '未設定の商品', price: 5000 }),
    ];
  }

  /** 絞り込みのプルダウンを開く。 */
  async function openCategoryFilter() {
    await userEvent.click(await screen.findByRole('button', { name: /^カテゴリー:/ }));
    return screen.getByRole('group', { name: 'カテゴリーで絞り込む' });
  }

  it('最初は「カテゴリー: すべて」で、定義の並び順のカテゴリーと「カテゴリー未設定」を選択肢に出す', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createCategorizedProducts() } }) });
    render(<ProductListPage currentTime={currentTime} />);

    const group = await openCategoryFilter();

    expect(screen.getByRole('button', { name: 'カテゴリー: すべて' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(group).getAllByRole('checkbox').map((checkbox) => checkbox.closest('label')?.textContent)).toEqual([
      'スケールフィギュア',
      '可動フィギュア',
      'カテゴリー未設定',
    ]);
  });

  it('カテゴリーを選んだ場合、そのカテゴリーの商品だけを表示し、見出しの個数と合計金額も絞り込んだ商品で数える', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createCategorizedProducts() } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('スケールの商品');

    const group = await openCategoryFilter();
    await userEvent.click(within(group).getByLabelText('スケールフィギュア'));

    expect(screen.getByRole('button', { name: 'カテゴリー: スケールフィギュア' })).toBeInTheDocument();
    expect(screen.getByText('スケールの商品')).toBeInTheDocument();
    expect(screen.queryByText('可動の商品')).not.toBeInTheDocument();
    expect(screen.queryByText('未設定の商品')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^2026\/11 / })).toHaveTextContent('1個（合計 20,000円見込）');
  });

  it('「カテゴリー未設定」も選んだ場合、両方の商品を表示し、ボタンに選んだものを並べる', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createCategorizedProducts() } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('スケールの商品');

    const group = await openCategoryFilter();
    await userEvent.click(within(group).getByLabelText('スケールフィギュア'));
    await userEvent.click(within(group).getByLabelText('カテゴリー未設定'));

    expect(screen.getByRole('button', { name: 'カテゴリー: スケールフィギュア、カテゴリー未設定' })).toBeInTheDocument();
    expect(screen.getByText('未設定の商品')).toBeInTheDocument();
    expect(screen.queryByText('可動の商品')).not.toBeInTheDocument();
  });

  it('「選択を解除（すべて表示）」を押した場合、すべての商品を表示する', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createCategorizedProducts() } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('スケールの商品');
    const group = await openCategoryFilter();
    await userEvent.click(within(group).getByLabelText('スケールフィギュア'));

    await userEvent.click(screen.getByRole('button', { name: '選択を解除（すべて表示）' }));

    expect(screen.getByRole('button', { name: 'カテゴリー: すべて' })).toBeInTheDocument();
    expect(screen.getByText('可動の商品')).toBeInTheDocument();
  });

  it('選んだカテゴリーを覚え、次に開いたときも絞り込んで表示する', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createCategorizedProducts() } }) });
    const { unmount } = render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('スケールの商品');
    const group = await openCategoryFilter();
    await userEvent.click(within(group).getByLabelText('可動フィギュア'));
    unmount();

    render(<ProductListPage currentTime={currentTime} />);

    expect(await screen.findByText('可動の商品')).toBeInTheDocument();
    expect(screen.queryByText('スケールの商品')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'カテゴリー: 可動フィギュア' })).toBeInTheDocument();
  });

  it('覚えているカテゴリーが選択肢にない場合（定義から消えたなど）、そのカテゴリーは選んでいないものとして扱う', async () => {
    localStorage.setItem(CATEGORY_FILTER_STORAGE_KEY, JSON.stringify({ categoryIds: ['removed'], includesUncategorized: false }));
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createCategorizedProducts() } }) });
    render(<ProductListPage currentTime={currentTime} />);

    expect(await screen.findByText('スケールの商品')).toBeInTheDocument();
    expect(screen.getByText('可動の商品')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'カテゴリー: すべて' })).toBeInTheDocument();
  });

  it('定義にないカテゴリーの商品がある場合、「名前（定義にない）」を選択肢に加え、選ぶとその商品を表示する', async () => {
    stubFetchRoutes({
      'GET /api/products': () => ({
        body: { products: [...createCategorizedProducts(), createProduct({ name: '旧カテゴリーの商品', categoryId: 'legacy', categoryName: '旧カテゴリー' })] },
      }),
    });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('旧カテゴリーの商品');

    const group = await openCategoryFilter();
    await userEvent.click(within(group).getByLabelText('旧カテゴリー（定義にない）'));

    expect(screen.getByText('旧カテゴリーの商品')).toBeInTheDocument();
    expect(screen.queryByText('スケールの商品')).not.toBeInTheDocument();
  });

  it('カテゴリーの定義に誤りがある場合、理由を表示し、絞り込みを使えなくし、商品はすべて表示する', async () => {
    stubFetchRoutes({
      'GET /api/products': () => ({ body: { products: createCategorizedProducts() } }),
      'GET /api/categories': () => ({
        status: 503,
        body: { error: { code: 'CATEGORY_DEFINITION_INVALID', message: 'カテゴリーの定義（categories.json）に誤りがあります: 2 行目' } },
      }),
    });
    render(<ProductListPage currentTime={currentTime} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('カテゴリーの定義（categories.json）に誤りがあります: 2 行目');
    expect(screen.getByRole('button', { name: /^カテゴリー:/ })).toBeDisabled();
    expect(screen.getByText('スケールの商品')).toBeInTheDocument();
    expect(screen.getByText('未設定の商品')).toBeInTheDocument();
  });

  it('追加のモーダルで、定義のカテゴリーを選べる', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByRole('region', { name: '2026/11' });

    await userEvent.click(screen.getByRole('button', { name: '商品を追加' }));

    const options = Array.from((within(screen.getByRole('dialog')).getByLabelText('カテゴリー') as HTMLSelectElement).options);
    expect(options.map((option) => option.text)).toEqual(['未設定', 'スケールフィギュア', '可動フィギュア']);
  });
});

describe('ドラッグアンドドロップ（issue #13）', () => {
  /** 2026/11 の「動かす商品」と、表示する月を 2027/01 まで広げる商品を返す。 */
  function createMovableProducts(): ProductResponse[] {
    return [
      createProduct({ id: 'moving', name: '動かす商品', releaseMonth: '2026-11' }),
      createProduct({ id: 'january', name: '1月の商品', releaseMonth: '2027-01' }),
    ];
  }

  /** 商品の一覧と発売月の移動を返すスタブ。移動すると一覧にも反映する。 */
  function stubMovableRoutes(options: { failsMove?: boolean } = {}) {
    let products = createMovableProducts();
    const stub = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'PATCH /api/products/moving/release-month': (body) => {
        if (options.failsMove === true) return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } };
        const releaseMonth = (body as { releaseMonth: string }).releaseMonth;
        products = products.map((product) => (product.id === 'moving' ? { ...product, releaseMonth } : product));
        return { body: products[0] };
      },
    });
    return stub;
  }

  /** 商品のカード（ドラッグする要素）を返す。 */
  function findCard(productName: string): HTMLElement {
    const card = screen.getByRole('button', { name: new RegExp(productName) }).closest('article');
    if (card === null) throw new Error(`カードが見つかりません: ${productName}`);
    return card;
  }

  /** マウスでカードを掴み、落とす先に落とす。 */
  function dragWithMouse(card: HTMLElement, target: HTMLElement): void {
    fireEvent.dragStart(card);
    fireEvent.dragEnter(target);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    fireEvent.dragEnd(card);
  }

  /** 発売月の移動の要求を返す。 */
  function listMoveRequests(requests: { method: string; path: string; body: unknown }[]) {
    return requests.filter((recorded) => recorded.method === 'PATCH');
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('マウスで別の月に落とした場合、その月への移動を送り、一覧を読み込み直し、「発売月を 2027/01 に移動しました」と「元に戻す」を表示する', async () => {
    const { requests } = stubMovableRoutes();
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');

    dragWithMouse(findCard('動かす商品'), screen.getByRole('region', { name: '2027/01' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('発売月を 2027/01 に移動しました');
    expect(within(notice).getByRole('button', { name: '元に戻す' })).toBeInTheDocument();
    expect(listMoveRequests(requests)).toEqual([
      { method: 'PATCH', path: '/api/products/moving/release-month', body: { releaseMonth: '2027-01' }, contentType: 'application/json' },
    ]);
    await waitFor(() => expect(within(screen.getByRole('region', { name: '2027/01' })).getByText('動かす商品')).toBeInTheDocument());
  });

  it('ドラッグ中は落とす先の月を強調し、月から離れたら・ドラッグを終えたら強調を外す', async () => {
    stubMovableRoutes();
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    const card = findCard('動かす商品');
    const january = screen.getByRole('region', { name: '2027/01' });

    fireEvent.dragStart(card);
    fireEvent.dragEnter(january);
    fireEvent.dragOver(january);
    expect(january).toHaveClass('month-group--drop-target');

    fireEvent.dragLeave(january, { relatedTarget: document.body });
    expect(january).not.toHaveClass('month-group--drop-target');

    fireEvent.dragEnter(january);
    fireEvent.dragEnd(card);
    expect(january).not.toHaveClass('month-group--drop-target');
  });

  it('同じ月に落とした場合、何も送らず、知らせも出さない', async () => {
    const { requests } = stubMovableRoutes();
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');

    dragWithMouse(findCard('動かす商品'), screen.getByRole('region', { name: '2026/11' }));

    expect(listMoveRequests(requests)).toEqual([]);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('折りたたんだ月の見出しに落とした場合も、その月に移動する', async () => {
    const { requests } = stubMovableRoutes();
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    const december = screen.getByRole('region', { name: '2026/12' });
    await userEvent.click(within(december).getByRole('button', { name: /^2026\/12 / }));

    dragWithMouse(findCard('動かす商品'), within(december).getByRole('button', { name: /^2026\/12 / }));

    expect(await screen.findByRole('status')).toHaveTextContent('発売月を 2026/12 に移動しました');
    expect(listMoveRequests(requests)[0]?.body).toEqual({ releaseMonth: '2026-12' });
  });

  it('「元に戻す」を押した場合、元の月に戻すよう送り、「発売月を 2026/11 に戻しました」と表示する', async () => {
    const { requests } = stubMovableRoutes();
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    dragWithMouse(findCard('動かす商品'), screen.getByRole('region', { name: '2027/01' }));

    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: '元に戻す' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('発売月を 2026/11 に戻しました'));
    expect(within(screen.getByRole('status')).queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
    expect(listMoveRequests(requests).map((recorded) => recorded.body)).toEqual([{ releaseMonth: '2027-01' }, { releaseMonth: '2026-11' }]);
    await waitFor(() => expect(within(screen.getByRole('region', { name: '2026/11' })).getByText('動かす商品')).toBeInTheDocument());
  });

  it('移動に失敗した場合、失敗したことを表示し、商品は元の月のまま', async () => {
    stubMovableRoutes({ failsMove: true });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');

    dragWithMouse(findCard('動かす商品'), screen.getByRole('region', { name: '2027/01' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('発売月を移動できませんでした。');
    expect(within(screen.getByRole('region', { name: '2026/11' })).getByText('動かす商品')).toBeInTheDocument();
  });

  it('移動の知らせは 8 秒で消える', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubMovableRoutes();
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    dragWithMouse(findCard('動かす商品'), screen.getByRole('region', { name: '2027/01' }));
    await screen.findByRole('status');

    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('続けて別の月に移動した場合、前の知らせを新しい知らせに置き換え、知らせは 1 つだけ表示する', async () => {
    stubMovableRoutes();
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    dragWithMouse(findCard('動かす商品'), screen.getByRole('region', { name: '2027/01' }));
    await screen.findByText('発売月を 2027/01 に移動しました');
    await waitFor(() => expect(within(screen.getByRole('region', { name: '2027/01' })).getByText('動かす商品')).toBeInTheDocument());

    dragWithMouse(findCard('動かす商品'), screen.getByRole('region', { name: '2026/12' }));

    await screen.findByText('発売月を 2026/12 に移動しました');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByText('発売月を 2027/01 に移動しました')).not.toBeInTheDocument();
  });

  it('「元に戻す」を押した後の知らせは、押したときから 8 秒で消える', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubMovableRoutes();
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    dragWithMouse(findCard('動かす商品'), screen.getByRole('region', { name: '2027/01' }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: '元に戻す' }));
    await screen.findByText('発売月を 2026/11 に戻しました');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('発売月を 2026/11 に戻しました');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('失敗の知らせも 8 秒で消え、「元に戻す」は付けない', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubMovableRoutes({ failsMove: true });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    dragWithMouse(findCard('動かす商品'), screen.getByRole('region', { name: '2027/01' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('マウスなどの細かく指せる端末では、カードをドラッグできる（draggable）。タッチだけの端末では、ブラウザ標準のドラッグを使わない', async () => {
    stubMovableRoutes();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: fine)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { unmount } = render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    expect(findCard('動かす商品')).toHaveAttribute('draggable', 'true');
    unmount();

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    expect(findCard('動かす商品')).not.toHaveAttribute('draggable', 'true');
  });

  it.each([
    ['商品を押して詳細画面を開いた（issue #52）', async () => userEvent.click(screen.getByRole('button', { name: /1月の商品/ }))],
    ['＋ボタンで追加のモーダルを開いた', async () => userEvent.click(screen.getByRole('button', { name: '商品を追加' }))],
    ['月の見出しの＋で追加のモーダルを開いた', async () => userEvent.click(screen.getByRole('button', { name: '2026/12に商品を追加' }))],
    [
      'カテゴリーの絞り込みを変えた',
      async () => {
        await userEvent.click(screen.getByRole('button', { name: /^カテゴリー:/ }));
        await userEvent.click(within(screen.getByRole('group', { name: 'カテゴリーで絞り込む' })).getByLabelText('スケールフィギュア'));
      },
    ],
  ])('知らせを表示している間に%s場合、すぐに知らせを閉じる', async (_label, startOtherOperation) => {
    stubMovableRoutes();
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    dragWithMouse(findCard('動かす商品'), screen.getByRole('region', { name: '2027/01' }));
    await screen.findByRole('status');

    await startOtherOperation();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  describe('タッチ操作', () => {
    /** 指の下にある要素として、落とす先を返すようにする（jsdom には elementFromPoint がないため）。 */
    function stubElementUnderFinger(element: Element | null): void {
      document.elementFromPoint = vi.fn(() => element);
    }

    it('カードを 0.4 秒長押しすると掴み、別の月まで動かして指を離すと、その月に移動する', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { requests } = stubMovableRoutes();
      render(<ProductListPage currentTime={currentTime} />);
      await screen.findByText('動かす商品');
      const card = findCard('動かす商品');
      const january = screen.getByRole('region', { name: '2027/01' });

      fireEvent.pointerDown(card, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 300 });
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(card).toHaveClass('product-card--grabbed');

      stubElementUnderFinger(within(january).getByRole('button', { name: /^2027\/01 / }));
      fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 60, clientY: 700 });
      expect(january).toHaveClass('month-group--drop-target');
      fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 60, clientY: 700 });

      expect(await screen.findByRole('status')).toHaveTextContent('発売月を 2027/01 に移動しました');
      expect(listMoveRequests(requests)[0]?.body).toEqual({ releaseMonth: '2027-01' });
      expect(card).not.toHaveClass('product-card--grabbed');
      expect(january).not.toHaveClass('month-group--drop-target');
    });

    it('長押しの前に指を動かした場合は掴まない（ページのスクロールとして扱う）', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { requests } = stubMovableRoutes();
      render(<ProductListPage currentTime={currentTime} />);
      await screen.findByText('動かす商品');
      const card = findCard('動かす商品');
      stubElementUnderFinger(screen.getByRole('region', { name: '2027/01' }));

      fireEvent.pointerDown(card, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 300 });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 340 });
      act(() => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 340 });

      expect(card).not.toHaveClass('product-card--grabbed');
      expect(listMoveRequests(requests)).toEqual([]);
    });

    it('短く触れた場合は、詳細画面を開く（issue #52 より前は編集のモーダル）', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      stubMovableRoutes();
      render(<ProductListPage currentTime={currentTime} />);
      await screen.findByText('動かす商品');
      const card = findCard('動かす商品');

      fireEvent.pointerDown(card, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 300 });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 300 });
      fireEvent.click(screen.getByRole('button', { name: /動かす商品/ }));

      expect(screen.getByRole('dialog', { name: '商品の詳細' })).toBeInTheDocument();
    });

    it('長押しで掴んだ後に指を離した場合は、詳細画面も編集のモーダルも開かない', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      stubMovableRoutes();
      render(<ProductListPage currentTime={currentTime} />);
      await screen.findByText('動かす商品');
      const card = findCard('動かす商品');
      stubElementUnderFinger(screen.getByRole('region', { name: '2026/11' }));

      fireEvent.pointerDown(card, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 300 });
      act(() => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 300 });
      fireEvent.click(screen.getByRole('button', { name: /動かす商品/ }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('場所と費用・カテゴリーごとの入力項目（issue #26・#27）', () => {
  /** 物品と電子チケットのカテゴリーの定義（電子チケットは送料を使わず、場所と費用を使う。その他費用の名前は「ドリンク代」）。 */
  const categoryRoutes = {
    'GET /api/categories': () => ({
      body: {
        categories: [
          { id: 'scale', name: 'スケールフィギュア', fields: ['shippingFee', 'maker', 'orderDeadline', 'cancelable'], otherExpenseLabel: 'その他費用' },
          { id: 'ticket', name: '電子チケット', fields: ['location', 'handlingFee', 'travelExpense', 'otherExpense'], otherExpenseLabel: 'ドリンク代' },
        ],
      },
    }),
  };

  it('電子チケットの商品のカードに、場所と、カテゴリーの名前で示した費用を表示し、「送料無料」は表示しない', async () => {
    stubFetchRoutes({
      ...categoryRoutes,
      'GET /api/products': () => ({
        body: {
          products: [
            createProduct({
              name: 'ライブ 東京公演',
              categoryId: 'ticket',
              categoryName: '電子チケット',
              price: 8800,
              location: '東京ドーム',
              handlingFee: 330,
              otherExpense: 600,
            }),
          ],
        },
      }),
    });
    render(<ProductListPage currentTime={currentTime} />);

    const card = (await screen.findByText('ライブ 東京公演')).closest('article');
    expect(card).not.toBeNull();
    await waitFor(() => expect(within(card as HTMLElement).getByText('ドリンク代 600円')).toBeInTheDocument());
    expect(within(card as HTMLElement).getByText('東京ドーム')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('手数料 330円')).toBeInTheDocument();
    expect(within(card as HTMLElement).queryByText('送料無料')).not.toBeInTheDocument();
  });

  it('見出しの合計金額に、手数料・交通費（見込）・その他費用を含める', async () => {
    stubFetchRoutes({
      ...categoryRoutes,
      'GET /api/products': () => ({
        body: {
          products: [
            createProduct({ categoryId: 'ticket', categoryName: '電子チケット', price: 8800, handlingFee: 330, travelExpense: 2000, otherExpense: 600 }),
          ],
        },
      }),
    });
    render(<ProductListPage currentTime={currentTime} />);

    expect(await screen.findByRole('region', { name: '2026/11' })).toBeInTheDocument();
    expect(screen.getAllByText(/1個（合計 11,730円見込）/).length).toBeGreaterThan(0);
  });

  it('追加のモーダルで電子チケットのカテゴリーを選んだ場合、カテゴリーの定義に従って場所と費用の入力欄を表示する', async () => {
    stubFetchRoutes({ ...categoryRoutes, 'GET /api/products': () => ({ body: { products: [] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByRole('region', { name: '2026/11' });

    await userEvent.click(screen.getByRole('button', { name: '商品を追加' }));
    const dialog = screen.getByRole('dialog', { name: '商品を追加' });
    await within(dialog).findByRole('option', { name: '電子チケット' });
    await userEvent.selectOptions(within(dialog).getByLabelText('カテゴリー'), '電子チケット');

    expect(within(dialog).getByLabelText('場所')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('ドリンク代')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('送料（税込）')).not.toBeInTheDocument();
  });
});

describe('スマートフォンの幅でのリスト形式（issue #15）', () => {
  /** スマートフォンの幅を判定するメディアクエリ（横幅 600px 以下）。 */
  const PHONE_WIDTH_QUERY = '(max-width: 600px)';

  /**
   * 画面の幅を偽装する。isPhoneWidth が true なら横幅 600px 以下として扱う（タッチ操作の端末とする）。
   * 戻り値の changeWidth で、画面の幅が変わったこと（端末の向きを変えたなど）を知らせる。
   */
  function stubScreenWidth(isPhoneWidth: boolean) {
    let matchesPhoneWidth = isPhoneWidth;
    const listeners = new Set<(event: { matches: boolean; media: string }) => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return query === PHONE_WIDTH_QUERY ? matchesPhoneWidth : false;
      },
      media: query,
      addEventListener: (_type: string, listener: (event: { matches: boolean; media: string }) => void) => {
        if (query === PHONE_WIDTH_QUERY) listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: { matches: boolean; media: string }) => void) => {
        listeners.delete(listener);
      },
    }));
    return {
      changeWidth(nextIsPhoneWidth: boolean) {
        matchesPhoneWidth = nextIsPhoneWidth;
        act(() => {
          for (const listener of listeners) listener({ matches: nextIsPhoneWidth, media: PHONE_WIDTH_QUERY });
        });
      },
    };
  }

  /** 商品名から、その商品の行（カード）を返す。 */
  function findProductItem(productName: string): HTMLElement {
    const item = screen.getByRole('button', { name: new RegExp(productName) }).closest('article');
    if (item === null) throw new Error(`商品が見つかりません: ${productName}`);
    return item;
  }

  /** 月の中で商品を並べている要素を返す。 */
  function findProductContainer(monthLabel: string): HTMLElement {
    const container = screen.getByRole('region', { name: monthLabel }).querySelector('.product-list, .product-grid');
    if (!(container instanceof HTMLElement)) throw new Error(`商品の並びが見つかりません: ${monthLabel}`);
    return container;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('横幅 600px 以下の場合、月の商品を 1 行に 1 件のリスト形式で表示する', async () => {
    stubScreenWidth(true);
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '1 件目' }), createProduct({ name: '2 件目' })] } }) });

    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('1 件目');

    const container = findProductContainer('2026/11');
    expect(container).toHaveClass('product-list');
    expect(container).not.toHaveClass('product-grid');
    expect(container).toContainElement(findProductItem('1 件目'));
    expect(container).toContainElement(findProductItem('2 件目'));
  });

  it('横幅が 600px より広い場合、今までどおりカードを横に並べる（グリッド）', async () => {
    stubScreenWidth(false);
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: 'PC の商品' })] } }) });

    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('PC の商品');

    const container = findProductContainer('2026/11');
    expect(container).toHaveClass('product-grid');
    expect(container).not.toHaveClass('product-list');
  });

  it('画面の幅が変わった場合（端末の向きを変えたなど）、表示の形式もそれに合わせて切り替える', async () => {
    const screenWidth = stubScreenWidth(true);
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '向きを変える商品' })] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('向きを変える商品');
    expect(findProductContainer('2026/11')).toHaveClass('product-list');

    screenWidth.changeWidth(false);
    expect(findProductContainer('2026/11')).toHaveClass('product-grid');

    screenWidth.changeWidth(true);
    expect(findProductContainer('2026/11')).toHaveClass('product-list');
  });

  it('リスト形式の場合、各行の左端（商品名より前）に共通のアイコンを表示し、ステータス・メーカー・商品名・金額・送料・備考の印・購入先を表示する', async () => {
    stubScreenWidth(true);
    const product = createProduct({
      name: '全部入りの商品',
      maker: 'メーカーA',
      price: 24200,
      shippingFee: 800,
      note: '初回特典付き',
      url: 'https://shop.example.jp/item/1',
    });
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [product] } }) });

    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('全部入りの商品');

    const item = findProductItem('全部入りの商品');
    const icon = item.querySelector('.product-card-placeholder');
    expect(icon).not.toBeNull();
    expect((icon?.compareDocumentPosition(within(item).getByText('全部入りの商品')) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(item).getByText('予約済')).toBeInTheDocument();
    expect(within(item).getByText('メーカーA')).toBeInTheDocument();
    expect(within(item).getByText('24,200円')).toBeInTheDocument();
    expect(within(item).getByText('送料 800円')).toBeInTheDocument();
    expect(within(item).getByRole('img', { name: '備考あり' })).toHaveTextContent('📝');
    expect(within(item).queryByText('初回特典付き')).not.toBeInTheDocument();
    expect(within(item).getByRole('link', { name: 'shop.example.jp' })).toBeInTheDocument();
  });

  it('リスト形式の場合も、送料が未入力または 0 円なら「送料無料」、金額が未入力なら「金額未入力」と表示する', async () => {
    stubScreenWidth(true);
    const products = [
      createProduct({ name: '送料未入力の商品', price: 19800, shippingFee: null }),
      createProduct({ name: '送料 0 円の商品', price: 19800, shippingFee: 0 }),
      createProduct({ name: '金額未入力の商品', price: null, shippingFee: 800 }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('送料未入力の商品');

    expect(within(findProductItem('送料未入力の商品')).getByText('送料無料')).toBeInTheDocument();
    expect(within(findProductItem('送料 0 円の商品')).getByText('送料無料')).toBeInTheDocument();
    const priceMissing = findProductItem('金額未入力の商品');
    expect(within(priceMissing).getByText('金額未入力')).toBeInTheDocument();
    expect(within(priceMissing).queryByText(/送料/)).not.toBeInTheDocument();
  });

  it('リスト形式の場合も、検討中で受注期限まで 1 週間以下の商品は商品名の先頭に ⚠️ を付け、受注期限を表示する', async () => {
    stubScreenWidth(true);
    stubFetchRoutes({
      'GET /api/products': () => ({ body: { products: [createProduct({ name: '期限が近い商品', status: 'considering', orderDeadline: '2026-11-24' })] } }),
    });

    render(<ProductListPage currentTime={currentTime} />);

    expect(await screen.findByText('⚠️ 期限が近い商品')).toBeInTheDocument();
    expect(within(findProductItem('期限が近い商品')).getByText('受注期限 11/24')).toBeInTheDocument();
  });

  it('リスト形式の場合も、検討中以外の商品には受注期限が近くても ⚠️ を付けず、受注期限も表示しない', async () => {
    stubScreenWidth(true);
    stubFetchRoutes({
      'GET /api/products': () => ({ body: { products: [createProduct({ name: '予約済の商品', status: 'reserved', orderDeadline: '2026-11-20' })] } }),
    });

    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('予約済の商品');

    const item = findProductItem('予約済の商品');
    expect(within(item).queryByText(/⚠️/)).not.toBeInTheDocument();
    expect(within(item).queryByText(/受注期限/)).not.toBeInTheDocument();
  });

  it.each([
    ['検討中', { status: 'considering', cancelable: false }, 'product-card--considering'],
    ['予約済', { status: 'reserved', cancelable: false }, 'product-card--reserved'],
    ['予約済（キャンセル可）', { status: 'reserved', cancelable: true }, 'product-card--cancelable'],
    ['購入済', { status: 'purchased', cancelable: false }, 'product-card--purchased'],
    ['未購入', { status: 'unpurchased', cancelable: false }, 'product-card--unpurchased'],
  ] as const)('リスト形式の場合も、%s の商品はカードと同じステータスの見た目（色分け・未購入の見せ方）で表示する', async (statusLabel, statusFields, statusClassName) => {
    stubScreenWidth(true);
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '色を見る商品', ...statusFields })] } }) });

    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('色を見る商品');

    const item = findProductItem('色を見る商品');
    expect(item).toHaveClass(statusClassName);
    expect(within(item).getByText(statusLabel)).toBeInTheDocument();
  });

  it('リスト形式の場合も、商品を押すと詳細画面を開く（issue #52 より前は編集のモーダル）', async () => {
    stubScreenWidth(true);
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '編集する商品' })] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('編集する商品');

    await userEvent.click(screen.getByRole('button', { name: /編集する商品/ }));

    expect(screen.getByRole('dialog', { name: '商品の詳細' })).toBeInTheDocument();
  });

  it('リスト形式の場合も、購入先のリンクは新しいタブで開き、詳細画面も編集のモーダルも開かない', async () => {
    stubScreenWidth(true);
    stubFetchRoutes({
      'GET /api/products': () => ({ body: { products: [createProduct({ name: 'リンクのある商品', url: 'https://shop.example.jp/item/1' })] } }),
    });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('リンクのある商品');

    const link = within(findProductItem('リンクのある商品')).getByRole('link', { name: 'shop.example.jp' });
    expect(link).toHaveAttribute('href', 'https://shop.example.jp/item/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await userEvent.click(link);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('リスト形式の場合も、行を 0.4 秒長押しして掴み、別の月まで動かして指を離すと、その月に移動する', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubScreenWidth(true);
    let products = [createProduct({ id: 'moving', name: '動かす商品', releaseMonth: '2026-11' }), createProduct({ name: '1月の商品', releaseMonth: '2027-01' })];
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'PATCH /api/products/moving/release-month': (body) => {
        const releaseMonth = (body as { releaseMonth: string }).releaseMonth;
        products = products.map((product) => (product.id === 'moving' ? { ...product, releaseMonth } : product));
        return { body: products[0] };
      },
    });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    expect(findProductContainer('2026/11')).toHaveClass('product-list');
    const item = findProductItem('動かす商品');
    const january = screen.getByRole('region', { name: '2027/01' });

    fireEvent.pointerDown(item, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 300 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(item).toHaveClass('product-card--grabbed');
    document.elementFromPoint = vi.fn(() => within(january).getByRole('button', { name: /^2027\/01 / }));
    fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 60, clientY: 700 });
    fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 60, clientY: 700 });

    expect(await screen.findByRole('status')).toHaveTextContent('発売月を 2027/01 に移動しました');
    expect(requests.filter((recorded) => recorded.method === 'PATCH')[0]?.body).toEqual({ releaseMonth: '2027-01' });
  });
});

describe('開催日時と開催期間の表示（PR #30 のレビュー）', () => {
  /** 画面の幅を偽装する。isPhoneWidth が true なら横幅 600px 以下として扱う。 */
  function stubScreenWidth(isPhoneWidth: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 600px)' ? isPhoneWidth : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  /** 開催日時（日本時間 11/20 18:00）と終了日時（同 21:00）を持つ商品を返すスタブ。 */
  function stubEventProduct() {
    stubFetchRoutes({
      'GET /api/products': () => ({
        body: {
          products: [
            createProduct({ name: 'ライブ 東京公演', eventStartsAt: '2026-11-20T09:00:00.000Z', eventEndsAt: '2026-11-20T12:00:00.000Z' }),
          ],
        },
      }),
    });
  }

  it('PC の幅（カードを並べる形式）では、開催日時と終了日時を表示する', async () => {
    stubScreenWidth(false);
    stubEventProduct();
    render(<ProductListPage currentTime={currentTime} />);

    const card = (await screen.findByText('ライブ 東京公演')).closest('article');
    expect(within(card as HTMLElement).getByText('開催 11/20 18:00〜21:00')).toBeInTheDocument();
  });

  it('スマートフォンの幅（リスト形式）では、開催期間を表示する', async () => {
    stubScreenWidth(true);
    stubEventProduct();
    render(<ProductListPage currentTime={currentTime} />);

    const item = (await screen.findByText('ライブ 東京公演')).closest('article');
    expect(within(item as HTMLElement).getByText('開催 約3時間')).toBeInTheDocument();
    expect(within(item as HTMLElement).queryByText(/18:00/)).not.toBeInTheDocument();
  });
});

describe('商品の画像を保存できなかった場合（issue #41）', () => {
  it('商品を保存できて画像を保存できなかった場合、モーダルを閉じて一覧を読み込み直し、画像を保存できなかったことを知らせる', async () => {
    let products = [createProduct({ name: '既存の商品' })];
    const added = createProduct({ name: '追加した商品' });
    stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'POST /api/products': () => {
        products = [...products, added];
        return { status: 201, body: added };
      },
      [`PUT /api/products/${added.id}/image`]: () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'error' } } }),
    });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('既存の商品');

    await userEvent.click(screen.getByRole('button', { name: '商品を追加' }));
    await userEvent.type(screen.getByLabelText('商品名'), '追加した商品');
    await userEvent.upload(screen.getByLabelText('画像'), new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('img', { name: '選んだ画像' });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('追加した商品')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('商品は保存しましたが、画像を保存できませんでした。');
  });
});

describe('カード画像の取得中の読み直し（issue #42）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 一覧の読み込み（GET /api/products）の回数を返す。 */
  function countListRequests(requests: readonly { method: string; path: string }[]): number {
    return requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products').length;
  }

  it('カード画像を取得中の商品がある場合、2 秒後に一覧を読み直し、取れた画像を表示する', async () => {
    const product = createProduct({ name: 'カードを取りに行く商品', url: 'https://shop.example.jp/item/1' });
    let listed = { ...product, cardImagePending: true };
    const { requests } = stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [listed] } }) });
    const { container } = render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('カードを取りに行く商品');
    expect(container.querySelector('.product-card-thumbnail img')).toBeNull();

    listed = { ...product, cardImagePending: false, imageUrl: `/api/products/${product.id}/image?v=card` };
    await act(() => vi.advanceTimersByTimeAsync(2000));

    await waitFor(() => expect(container.querySelector('.product-card-thumbnail img')).toHaveAttribute('src', `/api/products/${product.id}/image?v=card`));
    expect(countListRequests(requests)).toBe(2);
  });

  it('取得中の商品がなくなったら、それ以上は読み直さない', async () => {
    const product = createProduct({ name: 'カードを取りに行く商品' });
    let listed = { ...product, cardImagePending: true };
    const { requests } = stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [listed] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('カードを取りに行く商品');
    listed = { ...product, cardImagePending: false };

    await act(() => vi.advanceTimersByTimeAsync(2000));
    await waitFor(() => expect(countListRequests(requests)).toBe(2));
    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(countListRequests(requests)).toBe(2);
  });

  it('取得中の商品がない場合、読み直さない', async () => {
    const { requests } = stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '画像のない商品' })] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('画像のない商品');

    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(countListRequests(requests)).toBe(1);
  });

  it('取得中のままでも、読み直すのは 30 秒までにする', async () => {
    const product = createProduct({ name: '取得中のままの商品' });
    const { requests } = stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [{ ...product, cardImagePending: true }] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('取得中のままの商品');

    for (let elapsed = 0; elapsed < 60_000; elapsed += 2000) {
      await act(() => vi.advanceTimersByTimeAsync(2000));
    }

    expect(countListRequests(requests)).toBeGreaterThan(1);
    expect(countListRequests(requests)).toBeLessThanOrEqual(16);
  });
});

describe('商品の詳細画面（issue #52）', () => {
  /** 一覧に 1 件の商品を出し、その商品の操作の応答を返すスタブを作る。 */
  function stubDetailRoutes(extraRoutes: Parameters<typeof stubFetchRoutes>[0] = {}) {
    const product = createProduct({ id: 'detail-1', name: '詳細を見る商品', status: 'reserved', price: 2500, shippingFee: 660, discount: 500 });
    let products = [product];
    const stub = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'PUT /api/products/detail-1': () => ({ body: product }),
      'PATCH /api/products/detail-1/status': () => {
        products = [{ ...product, status: 'purchased' }];
        return { body: products[0] };
      },
      'DELETE /api/products/detail-1': () => {
        products = [];
        return { status: 204 };
      },
      ...extraRoutes,
    });
    return { ...stub, countListRequests: () => stub.requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products').length };
  }

  /** 商品を押して詳細画面を開き、そのモーダルを返す。 */
  async function openDetail(): Promise<HTMLElement> {
    await userEvent.click(await screen.findByRole('button', { name: /詳細を見る商品/ }));
    return screen.getByRole('dialog', { name: '商品の詳細' });
  }

  it('商品を押した場合、編集のモーダルではなく、その商品の詳細画面を開き、値引き後の最終的な金額と内訳を表示する', async () => {
    stubDetailRoutes();
    render(<ProductListPage currentTime={currentTime} />);

    const detail = await openDetail();

    expect(within(detail).getByRole('heading', { name: '詳細を見る商品' })).toBeInTheDocument();
    expect(within(detail).getByText('2,660円')).toBeInTheDocument();
    expect(within(detail).getByText('（2,500円 ＋ 送料 660円 − 値引き 500円）')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '商品を編集' })).not.toBeInTheDocument();
  });

  it('金額が未入力の商品の場合、カードは今までどおり「金額未入力」と表示し、詳細画面の金額は「－」と示す（読み上げでは「未入力」。issue #63）', async () => {
    const product = createProduct({ id: 'detail-1', name: '詳細を見る商品', price: null, shippingFee: 800 });
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [product] } }) });
    render(<ProductListPage currentTime={currentTime} />);

    const card = await screen.findByRole('button', { name: /詳細を見る商品/ });
    expect(within(card).getByText('金額未入力')).toBeInTheDocument();

    const detail = await openDetail();
    const marks = within(detail).getAllByRole('img', { name: '未入力' });
    expect(marks.some((mark) => mark.textContent === '－' && mark.closest('dd') === null)).toBe(true);
    expect(detail).not.toHaveTextContent('未入力');
  });

  it('一覧の商品の詳細画面には、「リストに戻す」を表示しない', async () => {
    stubDetailRoutes();
    render(<ProductListPage currentTime={currentTime} />);

    const detail = await openDetail();

    expect(within(detail).queryByRole('button', { name: 'リストに戻す' })).not.toBeInTheDocument();
  });

  it('詳細画面の閉じるボタン（×）を押した場合、詳細画面を閉じる', async () => {
    stubDetailRoutes();
    render(<ProductListPage currentTime={currentTime} />);

    const detail = await openDetail();
    await userEvent.click(getHeaderCloseButton(detail));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('「編集」を押した場合、詳細画面の代わりにその商品の編集のモーダルを開く', async () => {
    stubDetailRoutes();
    render(<ProductListPage currentTime={currentTime} />);

    const detail = await openDetail();
    await userEvent.click(within(detail).getByRole('button', { name: '編集' }));

    expect(screen.queryByRole('dialog', { name: '商品の詳細' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: '商品を編集' })).getByLabelText('商品名')).toHaveValue('詳細を見る商品');
  });

  it('編集のモーダルで保存した場合、一覧に戻り（詳細画面は開かない）、一覧を読み込み直す', async () => {
    const { countListRequests } = stubDetailRoutes();
    render(<ProductListPage currentTime={currentTime} />);

    const detail = await openDetail();
    await userEvent.click(within(detail).getByRole('button', { name: '編集' }));
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(countListRequests()).toBe(2));
  });

  it('編集のモーダルでキャンセルした場合、一覧に戻る（詳細画面は開かない）', async () => {
    stubDetailRoutes();
    render(<ProductListPage currentTime={currentTime} />);

    const detail = await openDetail();
    await userEvent.click(within(detail).getByRole('button', { name: '編集' }));
    await userEvent.click(getFooterButton(screen.getByRole('dialog', { name: '商品を編集' }), 'キャンセル'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('詳細画面でステータスを変えた場合、詳細画面は開いたまま、一覧を読み込み直して新しいステータスで表示する', async () => {
    const { countListRequests } = stubDetailRoutes();
    render(<ProductListPage currentTime={currentTime} />);

    const detail = await openDetail();
    await userEvent.selectOptions(within(detail).getByRole('combobox', { name: 'ステータス' }), '購入済');

    await waitFor(() => expect(countListRequests()).toBe(2));
    expect(screen.getByRole('dialog', { name: '商品の詳細' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /詳細を見る商品/ }).closest('article')).toHaveClass('product-card--purchased'));
  });

  it('詳細画面から削除した場合、詳細画面を閉じ、一覧を読み込み直して商品を消す', async () => {
    const { countListRequests } = stubDetailRoutes();
    render(<ProductListPage currentTime={currentTime} />);

    const detail = await openDetail();
    await userEvent.click(within(detail).getByRole('button', { name: '削除' }));
    await userEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(countListRequests()).toBe(2));
    expect(screen.queryByRole('button', { name: /詳細を見る商品/ })).not.toBeInTheDocument();
  });
});

describe('ステータス「キャンセル」の商品（issue #57）', () => {
  /** キャンセル（issue #57）。実装の前でも型チェックを通すため、文字列から変換して使う。 */
  const CANCELED_STATUS = 'canceled' as string as ProductResponse['status'];

  it('キャンセルの商品は、発売月が当月以降でもリストに表示せず、見出しの個数と合計金額にも含めない', async () => {
    const products = [
      createProduct({ name: '予約済の商品', releaseMonth: '2026-11', status: 'reserved', price: 13200 }),
      createProduct({ name: '今月のキャンセルした商品', releaseMonth: '2026-11', status: CANCELED_STATUS, price: 9800 }),
      createProduct({ name: '来年のキャンセルした商品', releaseMonth: '2027-01', status: CANCELED_STATUS, price: 5000 }),
    ];
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });

    render(<ProductListPage currentTime={currentTime} />);

    expect(await screen.findByText('予約済の商品')).toBeInTheDocument();
    expect(screen.queryByText('今月のキャンセルした商品')).not.toBeInTheDocument();
    expect(screen.queryByText('来年のキャンセルした商品')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^2026\/11 / })).toHaveTextContent('1個（合計 13,200円見込）');
    expect(screen.queryByRole('region', { name: '2027/01' })).not.toBeInTheDocument();
  });

  /** 一覧の商品と、ステータスの変更・編集の API を用意する。変えた後の一覧はキャンセルの商品を返す。 */
  function stubCancelRoutes() {
    const product = createProduct({ id: 'cancel-1', name: 'キャンセルする商品', releaseMonth: '2026-12', status: 'reserved', price: 5000 });
    let products = [product];
    const cancel = () => {
      products = [{ ...product, status: CANCELED_STATUS }];
      return { body: products[0] };
    };
    const stub = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'PATCH /api/products/cancel-1/status': cancel,
      'PUT /api/products/cancel-1': cancel,
    });
    return { ...stub, countListRequests: () => stub.requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products').length };
  }

  it('詳細画面で「キャンセル」を選んだ場合、{ status: canceled } を送り、一覧を読み込み直して、リストから消す', async () => {
    const { requests, countListRequests } = stubCancelRoutes();
    render(<ProductListPage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /キャンセルする商品/ }));
    await userEvent.selectOptions(within(screen.getByRole('dialog', { name: '商品の詳細' })).getByRole('combobox', { name: 'ステータス' }), 'キャンセル');

    await waitFor(() => expect(countListRequests()).toBe(2));
    expect(requests.find((recorded) => recorded.method === 'PATCH')).toMatchObject({ path: '/api/products/cancel-1/status', body: { status: 'canceled' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /キャンセルする商品/ })).not.toBeInTheDocument());
  });

  it('編集のモーダルで「キャンセル」を選んで保存した場合、一覧を読み込み直して、リストから消す', async () => {
    const { requests, countListRequests } = stubCancelRoutes();
    render(<ProductListPage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /キャンセルする商品/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: '商品の詳細' })).getByRole('button', { name: '編集' }));
    await userEvent.selectOptions(within(screen.getByRole('dialog', { name: '商品を編集' })).getByLabelText('ステータス'), 'キャンセル');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(countListRequests()).toBe(2));
    expect(requests.find((recorded) => recorded.method === 'PUT')).toMatchObject({ path: '/api/products/cancel-1', body: expect.objectContaining({ status: 'canceled' }) });
    await waitFor(() => expect(screen.queryByText('キャンセルする商品')).not.toBeInTheDocument());
  });
});

describe('発売月が未定の商品（issue #62）', () => {
  /** 発売月の未定（null）。実装の前でも型チェックを通すため、変換して使う。 */
  const UNDETERMINED_RELEASE_MONTH = null as unknown as string;

  /** 月の商品 1 件と、未定の商品 2 件。 */
  function createMixedProducts() {
    return [
      createProduct({ id: 'dated', name: '12月の商品', releaseMonth: '2026-12', price: 10000 }),
      createProduct({ id: 'undetermined-reserved', name: '未定の予約済の商品', releaseMonth: UNDETERMINED_RELEASE_MONTH, price: 5000 }),
      createProduct({ id: 'undetermined-considering', name: '未定の検討中の商品', releaseMonth: UNDETERMINED_RELEASE_MONTH, status: 'considering', price: 3000 }),
    ];
  }

  /** マウスでカードを掴み、落とす先に落とす。 */
  function dragCardTo(productName: string, target: HTMLElement): void {
    const card = screen.getByRole('button', { name: new RegExp(productName) }).closest('article');
    if (card === null) throw new Error(`カードが見つかりません: ${productName}`);
    fireEvent.dragStart(card);
    fireEvent.dragEnter(target);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    fireEvent.dragEnd(card);
  }

  it('未定の商品は、年・月のまとまりの一番下の「発売月未定」のまとまりに、個数と合計金額の見込みとともに表示し、年の見出しには含めない', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createMixedProducts() } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('12月の商品');

    const regions = screen.getAllByRole('region');
    const undeterminedGroup = regions.at(-1);
    if (undeterminedGroup === undefined) throw new Error('まとまりがない');
    expect(undeterminedGroup).toHaveAccessibleName('発売月未定');
    expect(within(undeterminedGroup).getByText('未定の予約済の商品')).toBeInTheDocument();
    expect(within(undeterminedGroup).getByText('未定の検討中の商品')).toBeInTheDocument();
    expect(within(undeterminedGroup).queryByText('12月の商品')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^発売月未定 / })).toHaveTextContent('2個（合計 8,000円見込）');
    expect(screen.getByRole('button', { name: /^2026年 / })).toHaveTextContent('1個（合計 10,000円見込）');
  });

  it('未定のまとまりの中の並び順は、月のまとまりと同じ（予約済が検討中より上）', async () => {
    const products = createMixedProducts().reverse();
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }) });
    render(<ProductListPage currentTime={currentTime} />);
    const undeterminedGroup = await screen.findByRole('region', { name: '発売月未定' });

    const names = within(undeterminedGroup)
      .getAllByRole('button', { name: /未定の/ })
      .map((button) => button.textContent ?? '');
    expect(names[0]).toContain('未定の予約済の商品');
    expect(names[1]).toContain('未定の検討中の商品');
  });

  it('未定の商品がない場合も、「発売月未定」のまとまりを表示する（ドラッグの移動先と追加のため。中は追加の空のカードだけ。issue #68）', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '12月の商品', releaseMonth: '2026-12' })] } }) });
    render(<ProductListPage currentTime={currentTime} />);

    const undeterminedGroup = await screen.findByRole('region', { name: '発売月未定' });
    expect(within(undeterminedGroup).getByRole('button', { name: '発売月未定に商品を追加' })).toBeInTheDocument();
    expect(within(undeterminedGroup).queryByText('商品はありません')).not.toBeInTheDocument();
  });

  it('未定のまとまりの追加のカード（issue #68 で見出しから移した）を押した場合、発売月を未定にした状態で追加のモーダルを開き、保存すると発売月を null で送る', async () => {
    const added = createProduct({ name: '追加した未定の商品', releaseMonth: UNDETERMINED_RELEASE_MONTH });
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products: [] } }),
      'POST /api/products': () => ({ status: 201, body: added }),
    });
    render(<ProductListPage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: '発売月未定に商品を追加' }));
    const dialog = screen.getByRole('dialog', { name: '商品を追加' });
    expect(within(dialog).getByRole('checkbox', { name: '未定' })).toBeChecked();
    expect(within(dialog).getByLabelText('発売月')).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('商品名'), '追加した未定の商品');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => expect(requests.find((recorded) => recorded.method === 'POST')).toBeDefined());
    expect(requests.find((recorded) => recorded.method === 'POST')?.body).toMatchObject({ name: '追加した未定の商品', releaseMonth: null });
  });

  it('月の商品を「発売月未定」のまとまりに落とした場合、発売月を null にする移動を送り、「発売月を未定に移動しました」と表示する', async () => {
    let products = createMixedProducts();
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'PATCH /api/products/dated/release-month': (body) => {
        const releaseMonth = (body as { releaseMonth: string | null }).releaseMonth as string;
        products = products.map((product) => (product.id === 'dated' ? { ...product, releaseMonth } : product));
        return { body: products.find((product) => product.id === 'dated') };
      },
    });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('12月の商品');

    dragCardTo('12月の商品', screen.getByRole('region', { name: '発売月未定' }));

    await waitFor(() => expect(requests.filter((recorded) => recorded.method === 'PATCH')).toHaveLength(1));
    expect(requests.find((recorded) => recorded.method === 'PATCH')).toMatchObject({
      path: '/api/products/dated/release-month',
      body: { releaseMonth: null },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('発売月を未定に移動しました');
  });

  it('未定の商品を月のまとまりに落とした場合、その月への移動を送る', async () => {
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products: createMixedProducts() } }),
      'PATCH /api/products/undetermined-reserved/release-month': () => ({ body: createMixedProducts()[1] }),
    });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('未定の予約済の商品');

    dragCardTo('未定の予約済の商品', screen.getByRole('region', { name: '2026/12' }));

    await waitFor(() => expect(requests.filter((recorded) => recorded.method === 'PATCH')).toHaveLength(1));
    expect(requests.find((recorded) => recorded.method === 'PATCH')).toMatchObject({
      path: '/api/products/undetermined-reserved/release-month',
      body: { releaseMonth: '2026-12' },
    });
  });

  it('未定の商品の詳細画面では、発売月を「未定」と表示する', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createMixedProducts() } }) });
    render(<ProductListPage currentTime={currentTime} />);

    await userEvent.click(await screen.findByRole('button', { name: /未定の予約済の商品/ }));

    const detail = screen.getByRole('dialog', { name: '商品の詳細' });
    const term = within(detail).getByText('発売月', { selector: 'dt' });
    expect(term.nextElementSibling).toHaveTextContent(/^未定$/);
  });
});

describe('追加の空のカード（issue #68）', () => {
  /** 画面の幅を偽装する。isPhoneWidth が true なら横幅 600px 以下として扱う。 */
  function stubScreenWidth(isPhoneWidth: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 600px)' ? isPhoneWidth : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  /** 2026/11 の商品 2 件と、未定の商品 1 件。 */
  function createProducts(): ProductResponse[] {
    return [
      createProduct({ name: '11月の商品 A', releaseMonth: '2026-11' }),
      createProduct({ name: '11月の商品 B', releaseMonth: '2026-11', status: 'considering' }),
      createProduct({ name: '未定の商品', releaseMonth: null as unknown as string }),
    ];
  }

  it('月と発売月未定の見出しには、追加ボタンを置かない', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createProducts() } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('11月の商品 A');

    for (const heading of screen.getAllByRole('heading')) {
      expect(within(heading).queryByRole('button', { name: /に商品を追加$/ })).not.toBeInTheDocument();
    }
  });

  it.each([
    ['PC の幅', false],
    ['スマートフォンの幅', true],
  ])('%sでは、各月の追加のカードを、その月の商品の並びの最後（最後の商品より後）に置く', async (_label, isPhoneWidth) => {
    stubScreenWidth(isPhoneWidth);
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createProducts() } }) });
    render(<ProductListPage currentTime={currentTime} />);
    const november = await screen.findByRole('region', { name: '2026/11' });

    const addButton = within(november).getByRole('button', { name: '2026/11に商品を追加' });
    const cards = within(november).getAllByRole('article');
    const lastCard = cards.at(-1);
    if (lastCard === undefined) throw new Error('カードがない');
    expect(lastCard.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lastCard.parentElement).toBe(addButton.closest('.product-grid, .product-list'));
  });

  it('発売月未定のまとまりでも、追加のカードを商品の並びの最後に置く', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createProducts() } }) });
    render(<ProductListPage currentTime={currentTime} />);
    const undeterminedGroup = await screen.findByRole('region', { name: '発売月未定' });

    const addButton = within(undeterminedGroup).getByRole('button', { name: '発売月未定に商品を追加' });
    const lastCard = within(undeterminedGroup).getAllByRole('article').at(-1);
    if (lastCard === undefined) throw new Error('カードがない');
    expect(lastCard.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('追加のカードは「＋」だけを表示し、ドラッグできない', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: createProducts() } }) });
    render(<ProductListPage currentTime={currentTime} />);
    const november = await screen.findByRole('region', { name: '2026/11' });

    const addButton = within(november).getByRole('button', { name: '2026/11に商品を追加' });
    expect(addButton).toHaveTextContent(/^＋$/);
    expect(addButton.closest('[draggable="true"]')).toBeNull();
  });

  it('商品を別の月の追加のカードの上に落とした場合も、その月に移動する', async () => {
    let products = [createProduct({ id: 'moving', name: '動かす商品', releaseMonth: '2026-11' }), createProduct({ name: '1月の商品', releaseMonth: '2027-01' })];
    const { requests } = stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'PATCH /api/products/moving/release-month': (body) => {
        const releaseMonth = (body as { releaseMonth: string }).releaseMonth;
        products = products.map((product) => (product.id === 'moving' ? { ...product, releaseMonth } : product));
        return { body: products[0] };
      },
    });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('動かす商品');
    const card = screen.getByRole('button', { name: /動かす商品/ }).closest('article');
    if (card === null) throw new Error('カードがない');
    const target = screen.getByRole('button', { name: '2026/12に商品を追加' });

    fireEvent.dragStart(card);
    fireEvent.dragEnter(target);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    fireEvent.dragEnd(card);

    await waitFor(() => expect(requests.filter((recorded) => recorded.method === 'PATCH')).toHaveLength(1));
    expect(requests.find((recorded) => recorded.method === 'PATCH')?.body).toEqual({ releaseMonth: '2026-12' });
  });
});
