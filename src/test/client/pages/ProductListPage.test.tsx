// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORY_FILTER_STORAGE_KEY, ProductListPage, YEAR_MODE_STORAGE_KEY } from '../../../client/pages/ProductListPage.tsx';
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
    categoryId: null,
    categoryName: null,
    maker: null,
    note: null,
    location: null,
    handlingFee: null,
    travelExpense: null,
    otherExpense: null,
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
    await waitFor(() => expect(requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products')).toHaveLength(2));
  });
});

describe('月ごとの追加ボタン（issue #16）', () => {
  it('月の見出しの追加ボタンを押した場合、発売月がその月の追加のモーダルを開く（商品のない月も含む）', async () => {
    stubFetchRoutes({
      'GET /api/products': () => ({ body: { products: [createProduct({ releaseMonth: '2027-02' })] } }),
    });
    render(<ProductListPage currentTime={currentTime} />);
    const january = await screen.findByRole('region', { name: '2027/01' });

    await userEvent.click(within(january).getByRole('button', { name: '2027/01に商品を追加' }));

    const dialog = screen.getByRole('dialog', { name: '商品を追加' });
    expect(within(dialog).getByLabelText('発売月')).toHaveValue('2027-01');
  });

  it('月の見出しを折りたたんでも、その月の追加ボタンは押せる', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct()] } }) });
    render(<ProductListPage currentTime={currentTime} />);
    await screen.findByText('商品 ' + String(createdCount));

    await userEvent.click(screen.getByRole('button', { name: /^2026\/11 / }));
    await userEvent.click(screen.getByRole('button', { name: '2026/11に商品を追加' }));

    expect(within(screen.getByRole('dialog', { name: '商品を追加' })).getByLabelText('発売月')).toHaveValue('2026-11');
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
    const dialog = screen.getByRole('dialog', { name: '商品を追加' });
    await within(dialog).findByRole('option', { name: 'スケールフィギュア' });
    await userEvent.selectOptions(within(dialog).getByLabelText('カテゴリー'), 'スケールフィギュア');

    const makerInput = within(dialog).getByLabelText('メーカー');
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
    ['商品を押して編集のモーダルを開いた', async () => userEvent.click(screen.getByRole('button', { name: /1月の商品/ }))],
    ['＋ボタンで追加のモーダルを開いた', async () => userEvent.click(screen.getByRole('button', { name: '商品を追加' }))],
    ['月の見出しの＋で追加のモーダルを開いた', async () => userEvent.click(screen.getByRole('button', { name: '2026/12に商品を追加' }))],
    ['年のまとめ方を切り替えた', async () => userEvent.click(screen.getByLabelText('年度'))],
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

    it('短く触れた場合は、今までどおり編集のモーダルを開く', async () => {
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

      expect(screen.getByRole('dialog', { name: '商品を編集' })).toBeInTheDocument();
    });

    it('長押しで掴んだ後に指を離した場合は、編集のモーダルを開かない', async () => {
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
