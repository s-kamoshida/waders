// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../client/App.tsx';
import type { ProductListItem } from '../../shared/productContract.ts';
import { getFooterButton } from './dialogCloseButtonQueries.ts';
import { stubFetchRoutes } from './testFetchStub.ts';

/** 値引きなし（issue #50）。既存の商品・テストの既定の値として、フィクスチャに展開して加える。 */
const NO_DISCOUNT = { discount: null } as const;
/** 画像なし（issue #51 の画像の種類）。項目ができる前でも型に合うよう、フィクスチャには展開して加える。 */
const NO_IMAGE_KIND = { imageKind: null } as const;

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
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
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

    expect(await screen.findByRole('tab', { name: 'リスト' })).toHaveAttribute('aria-selected', 'true');
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
    const getCountBeforeAnswer = requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products').length;

    await userEvent.click(screen.getByLabelText('延期された'));
    await userEvent.click(screen.getByRole('button', { name: '回答を保存' }));

    expect(await screen.findByText('延期された商品')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products').length).toBeGreaterThan(getCountBeforeAnswer);
  });

  it('移動の知らせを表示している間にタブを切り替えた場合、知らせを閉じる（issue #13）', async () => {
    let products = [createProduct({ name: '動かす商品', releaseMonth: '2026-11' }), createProduct({ id: 'product-2', name: '12月の商品', releaseMonth: '2026-12' })];
    stubFetchRoutes({
      'GET /api/products': () => ({ body: { products } }),
      'PATCH /api/products/product-1/release-month': () => {
        products = products.map((product) => (product.id === 'product-1' ? { ...product, releaseMonth: '2026-12' } : product));
        return { body: products[0] };
      },
    });
    render(<App currentTime={currentTime} />);
    const card = (await screen.findByRole('button', { name: /動かす商品/ })).closest('article');
    if (card === null) throw new Error('カードが見つかりません');
    fireEvent.dragStart(card);
    fireEvent.dragOver(screen.getByRole('region', { name: '2026/12' }));
    fireEvent.drop(screen.getByRole('region', { name: '2026/12' }));
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('tab', { name: 'アーカイブ' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  describe('カテゴリーの管理（issue #10）', () => {
    it('ヘッダーの「カテゴリーの管理」を押した場合、カテゴリーの管理のモーダルを開く', async () => {
      stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [] } }) });
      render(<App currentTime={currentTime} />);

      await userEvent.click(await within(screen.getByRole('banner')).findByRole('button', { name: 'カテゴリーの管理' }));

      expect(await screen.findByRole('dialog', { name: 'カテゴリーの管理' })).toBeInTheDocument();
    });

    it('カテゴリーを変更してから閉じた場合、表示中の一覧とカテゴリーを読み込み直し、新しいカテゴリーで絞り込める', async () => {
      let categories = [{ id: 'scale', name: 'スケールフィギュア' }];
      const { requests } = stubFetchRoutes({
        'GET /api/products': () => ({ body: { products: [] } }),
        'GET /api/categories': () => ({ body: { categories } }),
        'POST /api/categories': () => {
          categories = [...categories, { id: 'plastic', name: 'プラモデル' }];
          return { status: 201, body: { id: 'plastic', name: 'プラモデル' } };
        },
      });
      render(<App currentTime={currentTime} />);
      await userEvent.click(await within(screen.getByRole('banner')).findByRole('button', { name: 'カテゴリーの管理' }));
      const dialog = await screen.findByRole('dialog', { name: 'カテゴリーの管理' });
      await userEvent.type(await within(dialog).findByRole('textbox', { name: '新しいカテゴリー' }), 'プラモデル{Enter}');
      await within(dialog).findByRole('group', { name: 'プラモデル' });
      const productLoadCount = requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products').length;

      await userEvent.click(getFooterButton(dialog, '閉じる'));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() =>
        expect(requests.filter((recorded) => recorded.method === 'GET' && recorded.path === '/api/products').length).toBeGreaterThan(productLoadCount),
      );
      await userEvent.click(await screen.findByRole('button', { name: /^カテゴリー:/ }));
      expect(within(screen.getByRole('group', { name: 'カテゴリーで絞り込む' })).getByLabelText('プラモデル')).toBeInTheDocument();
    });

    it('何も変えずに閉じた場合、一覧を読み込み直さない', async () => {
      const { requests } = stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [] } }) });
      render(<App currentTime={currentTime} />);
      await screen.findByRole('region', { name: '2026/11' });
      await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'カテゴリーの管理' }));
      const dialog = await screen.findByRole('dialog', { name: 'カテゴリーの管理' });
      await within(dialog).findByRole('group', { name: 'スケールフィギュア' });
      const requestCount = requests.length;

      await userEvent.click(getFooterButton(dialog, '閉じる'));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(requests.length).toBe(requestCount);
    });
  });
});

describe('認証（issue #11）', () => {
  /** 認証が有効なときの状態。 */
  const authenticationStatus = (accountExists: boolean, loggedIn: boolean) => ({ authenticationEnabled: true, accountExists, loggedIn });

  /** 商品の一覧を読み込んだかを返す。 */
  const hasLoadedProducts = (requests: readonly { method: string; path: string }[]) =>
    requests.some((recorded) => recorded.method === 'GET' && recorded.path === '/api/products');

  it('認証が無効な場合、ログインの画面を出さずに一覧を表示し、「ログアウト」を表示しない', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: '一覧の商品' })] } }) });
    render(<App currentTime={currentTime} />);

    expect(await screen.findByText('一覧の商品')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ログイン' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument();
  });

  describe('アカウントがない場合', () => {
    it('アカウントの作成の画面を表示し、一覧・タブ・カテゴリーの管理は表示せず、商品を読み込まない', async () => {
      const { requests } = stubFetchRoutes({ 'GET /api/auth/status': () => ({ body: authenticationStatus(false, false) }) });
      render(<App currentTime={currentTime} />);

      expect(await screen.findByRole('heading', { name: 'アカウントの作成' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'ID' })).toBeInTheDocument();
      expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
      expect(screen.getByLabelText('パスワード（確認）')).toBeInTheDocument();
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'カテゴリーの管理' })).not.toBeInTheDocument();
      expect(hasLoadedProducts(requests)).toBe(false);
    });

    it('ID とパスワードを入力して作成した場合、ID とパスワードを送り、一覧を表示する', async () => {
      let status = authenticationStatus(false, false);
      const { requests } = stubFetchRoutes({
        'GET /api/auth/status': () => ({ body: status }),
        'POST /api/auth/setup': () => {
          status = authenticationStatus(true, true);
          return { status: 201, body: status };
        },
        'GET /api/products': () => ({ body: { products: [createProduct({ name: '一覧の商品' })] } }),
      });
      render(<App currentTime={currentTime} />);
      await userEvent.type(await screen.findByRole('textbox', { name: 'ID' }), 'owner');
      await userEvent.type(screen.getByLabelText('パスワード'), 'correct-horse');
      await userEvent.type(screen.getByLabelText('パスワード（確認）'), 'correct-horse');

      await userEvent.click(screen.getByRole('button', { name: 'アカウントを作成' }));

      expect(await screen.findByText('一覧の商品')).toBeInTheDocument();
      const setupRequest = requests.find((recorded) => recorded.method === 'POST' && recorded.path === '/api/auth/setup');
      expect(setupRequest?.body).toEqual({ loginId: 'owner', password: 'correct-horse' });
      expect(setupRequest?.contentType).toBe('application/json');
    });

    it('確認のパスワードが一致しない場合、理由を表示し、送らない', async () => {
      const { requests } = stubFetchRoutes({ 'GET /api/auth/status': () => ({ body: authenticationStatus(false, false) }) });
      render(<App currentTime={currentTime} />);
      await userEvent.type(await screen.findByRole('textbox', { name: 'ID' }), 'owner');
      await userEvent.type(screen.getByLabelText('パスワード'), 'correct-horse');
      await userEvent.type(screen.getByLabelText('パスワード（確認）'), 'different-horse');

      await userEvent.click(screen.getByRole('button', { name: 'アカウントを作成' }));

      expect(await screen.findByText('パスワードが一致しません。')).toBeInTheDocument();
      expect(requests.some((recorded) => recorded.path === '/api/auth/setup')).toBe(false);
    });

    it('パスワードが 8 文字未満の場合、理由を表示し、送らない', async () => {
      const { requests } = stubFetchRoutes({ 'GET /api/auth/status': () => ({ body: authenticationStatus(false, false) }) });
      render(<App currentTime={currentTime} />);
      await userEvent.type(await screen.findByRole('textbox', { name: 'ID' }), 'owner');
      await userEvent.type(screen.getByLabelText('パスワード'), 'short');
      await userEvent.type(screen.getByLabelText('パスワード（確認）'), 'short');

      await userEvent.click(screen.getByRole('button', { name: 'アカウントを作成' }));

      expect(await screen.findByText('パスワードは8文字以上にしてください。')).toBeInTheDocument();
      expect(requests.some((recorded) => recorded.path === '/api/auth/setup')).toBe(false);
    });
  });

  describe('アカウントがあり、ログインしていない場合', () => {
    it('ログインの画面を表示し、一覧・タブ・カテゴリーの管理は表示せず、商品を読み込まない', async () => {
      const { requests } = stubFetchRoutes({ 'GET /api/auth/status': () => ({ body: authenticationStatus(true, false) }) });
      render(<App currentTime={currentTime} />);

      expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'ID' })).toBeInTheDocument();
      expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'カテゴリーの管理' })).not.toBeInTheDocument();
      expect(hasLoadedProducts(requests)).toBe(false);
    });

    it('ログインに成功した場合、一覧と「ログアウト」を表示する', async () => {
      let status = authenticationStatus(true, false);
      const { requests } = stubFetchRoutes({
        'GET /api/auth/status': () => ({ body: status }),
        'POST /api/auth/login': () => {
          status = authenticationStatus(true, true);
          return { body: status };
        },
        'GET /api/products': () => ({ body: { products: [createProduct({ name: '一覧の商品' })] } }),
      });
      render(<App currentTime={currentTime} />);
      await userEvent.type(await screen.findByRole('textbox', { name: 'ID' }), 'owner');
      await userEvent.type(screen.getByLabelText('パスワード'), 'correct-horse');

      await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));

      expect(await screen.findByText('一覧の商品')).toBeInTheDocument();
      expect(within(screen.getByRole('banner')).getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
      expect(requests.find((recorded) => recorded.path === '/api/auth/login')?.body).toEqual({ loginId: 'owner', password: 'correct-horse' });
    });

    it.each([
      ['ID かパスワードが誤り', 401, 'LOGIN_FAILED', 'ID またはパスワードが違います。'],
      ['失敗が続いて制限中', 429, 'LOGIN_LOCKED', 'ログインの失敗が続いたため、15分間ログインできません。時間をおいてやり直してください。'],
    ])('ログインに失敗した（%s）場合、サーバーの理由を表示し、ログインの画面のままにする', async (_label, status, code, message) => {
      stubFetchRoutes({
        'GET /api/auth/status': () => ({ body: authenticationStatus(true, false) }),
        'POST /api/auth/login': () => ({ status, body: { error: { code, message } } }),
      });
      render(<App currentTime={currentTime} />);
      await userEvent.type(await screen.findByRole('textbox', { name: 'ID' }), 'owner');
      await userEvent.type(screen.getByLabelText('パスワード'), 'wrong-password');

      await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
    });
  });

  describe('ログインしている場合', () => {
    it('「ログアウト」を押した場合、ログアウトを送り、ログインの画面を表示する', async () => {
      let status = authenticationStatus(true, true);
      const { requests } = stubFetchRoutes({
        'GET /api/auth/status': () => ({ body: status }),
        'POST /api/auth/logout': () => {
          status = authenticationStatus(true, false);
          return { status: 204 };
        },
        'GET /api/products': () => ({ body: { products: [createProduct({ name: '一覧の商品' })] } }),
      });
      render(<App currentTime={currentTime} />);
      await screen.findByText('一覧の商品');

      await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'ログアウト' }));

      expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
      expect(screen.queryByText('一覧の商品')).not.toBeInTheDocument();
      expect(requests.find((recorded) => recorded.path === '/api/auth/logout')?.contentType).toBe('application/json');
    });

    it('使っている間に API が 401（ログインの期限切れなど）を返した場合、ログインの画面を表示する', async () => {
      stubFetchRoutes({
        'GET /api/auth/status': () => ({ body: authenticationStatus(true, true) }),
        'GET /api/products': () => ({ status: 401, body: { error: { code: 'AUTHENTICATION_REQUIRED', message: 'ログインしてください。' } } }),
      });
      render(<App currentTime={currentTime} />);

      expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });
  });

  it('認証の状態を取得できない場合、理由を表示し、一覧を表示しない', async () => {
    const { requests } = stubFetchRoutes({
      'GET /api/auth/status': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'サーバーでエラーが発生しました。' } } }),
    });
    render(<App currentTime={currentTime} />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(hasLoadedProducts(requests)).toBe(false);
  });
});

describe('ページの中の領域でのスクロール（issue #21）', () => {
  /** 画面のスタイル（本番と同じ CSS）。jsdom は CSS を読み込まないため、テストで文書に加える（テストはリポジトリの最上位で実行する）。 */
  const STYLESHEET_TEXT = readFileSync(join(process.cwd(), 'src/client/styles.css'), 'utf8');

  let removeStylesheet: () => void = () => {};

  beforeEach(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = STYLESHEET_TEXT;
    document.head.append(styleElement);
    removeStylesheet = () => styleElement.remove();
  });

  afterEach(() => {
    removeStylesheet();
    vi.useRealTimers();
  });

  /** 要素の縦方向のスクロールの指定（overflow-y の計算値）を返す。 */
  const readOverflowY = (element: Element) => getComputedStyle(element).overflowY;

  /**
   * 要素を囲む、縦にスクロールできる領域（overflow-y が auto か scroll の祖先。html・body は除く）を返す。
   * 見つからなければ null。
   */
  function findScrollRegion(element: Element): HTMLElement | null {
    for (let ancestor = element.parentElement; ancestor !== null && ancestor !== document.body; ancestor = ancestor.parentElement) {
      if (['auto', 'scroll'].includes(readOverflowY(ancestor))) return ancestor;
    }
    return null;
  }

  /** 一覧の領域を返す。見つからなければテストを失敗させる。 */
  function getScrollRegion(element: Element): HTMLElement {
    const region = findScrollRegion(element);
    if (region === null) throw new Error('一覧をスクロールさせる領域が見つかりません');
    return region;
  }

  it('リストを表示している場合、ページ自体はスクロールさせず、一覧をヘッダーの外にあるページの中の領域でスクロールさせる', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: 'リストの商品' })] } }) });
    render(<App currentTime={currentTime} />);

    const region = getScrollRegion(await screen.findByText('リストの商品'));

    expect(readOverflowY(document.documentElement)).toBe('hidden');
    expect(region).toContainElement(screen.getByRole('button', { name: '商品を追加' }));
    expect(region).not.toContainElement(screen.getByRole('banner'));
  });

  it('アーカイブを表示している場合も、ページ自体はスクロールさせず、アーカイブをページの中の領域でスクロールさせる', async () => {
    stubFetchRoutes({
      'GET /api/products': () => ({
        body: { products: [createProduct({ id: 'product-2', name: 'アーカイブの商品', releaseMonth: '2026-10', status: 'purchased' })] },
      }),
    });
    render(<App currentTime={currentTime} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'アーカイブ' }));

    const region = getScrollRegion(await screen.findByText('アーカイブの商品'));

    expect(readOverflowY(document.documentElement)).toBe('hidden');
    expect(region).not.toContainElement(screen.getByRole('banner'));
  });

  it('ログインの画面を表示している場合も、ページ自体はスクロールさせず、ページの中の領域でスクロールさせる', async () => {
    stubFetchRoutes({ 'GET /api/auth/status': () => ({ body: { authenticationEnabled: true, accountExists: true, loggedIn: false } }) });
    render(<App currentTime={currentTime} />);

    const region = getScrollRegion(await screen.findByRole('heading', { name: 'ログイン' }));

    expect(readOverflowY(document.documentElement)).toBe('hidden');
    expect(region).not.toContainElement(screen.getByRole('banner'));
  });

  it('追加のモーダルを開いている間は一覧の領域をスクロールさせず、閉じたらスクロールできるように戻す', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: 'リストの商品' })] } }) });
    render(<App currentTime={currentTime} />);
    const region = getScrollRegion(await screen.findByText('リストの商品'));

    await userEvent.click(screen.getByRole('button', { name: '商品を追加' }));

    expect(screen.getByRole('dialog', { name: '商品を追加' })).toBeInTheDocument();
    expect(readOverflowY(region)).toBe('hidden');

    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(['auto', 'scroll']).toContain(readOverflowY(region));
  });

  it('カテゴリーの管理のモーダルを開いている間も一覧の領域をスクロールさせず、閉じたらスクロールできるように戻す', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: 'リストの商品' })] } }) });
    render(<App currentTime={currentTime} />);
    const region = getScrollRegion(await screen.findByText('リストの商品'));

    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'カテゴリーの管理' }));
    const dialog = await screen.findByRole('dialog', { name: 'カテゴリーの管理' });

    expect(readOverflowY(region)).toBe('hidden');

    await userEvent.click(getFooterButton(dialog, '閉じる'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(['auto', 'scroll']).toContain(readOverflowY(region));
  });

  it('一覧をスクロールした後にモーダルを開いて備考の入力欄にフォーカスし、閉じた場合、一覧の領域は開く前の位置のまま', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: 'リストの商品' })] } }) });
    render(<App currentTime={currentTime} />);
    const region = getScrollRegion(await screen.findByText('リストの商品'));
    region.scrollTop = 500;

    await userEvent.click(screen.getByRole('button', { name: '商品を追加' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: '商品を追加' })).getByLabelText('備考'));
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(region.scrollTop).toBe(500);
  });

  describe('タッチ操作のドラッグでの自動スクロール（issue #13）', () => {
    /** 2026/11 の「動かす商品」と、表示する月を 2027/01 まで広げる商品を表示する。 */
    async function renderMovableProducts() {
      stubFetchRoutes({
        'GET /api/products': () => ({
          body: {
            products: [
              createProduct({ id: 'moving', name: '動かす商品', releaseMonth: '2026-11' }),
              createProduct({ id: 'january', name: '1月の商品', releaseMonth: '2027-01' }),
            ],
          },
        }),
      });
      render(<App currentTime={currentTime} />);
      const card = (await screen.findByRole('button', { name: /動かす商品/ })).closest('article');
      if (card === null) throw new Error('カードが見つかりません');
      // jsdom には elementFromPoint がないため、指の下には動かす商品の月があるものとする
      document.elementFromPoint = vi.fn(() => screen.getByRole('region', { name: '2026/11' }));
      return { card, region: getScrollRegion(card) };
    }

    /** カードを 0.4 秒長押しして掴み、指を画面の縦の位置 clientY まで動かして、しばらく待つ。 */
    function grabAndMoveTo(card: HTMLElement, clientY: number): void {
      fireEvent.pointerDown(card, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 300 });
      act(() => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY });
      act(() => {
        vi.advanceTimersByTime(200);
      });
    }

    it('掴んだ商品を画面の下端まで動かした場合、ページではなく一覧の領域を下にスクロールする', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { card, region } = await renderMovableProducts();
      const pageScrollTop = document.documentElement.scrollTop;

      grabAndMoveTo(card, window.innerHeight - 10);

      expect(region.scrollTop).toBeGreaterThan(0);
      expect(document.documentElement.scrollTop).toBe(pageScrollTop);
      fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: window.innerHeight - 10 });
    });

    it('掴んだ商品を画面の上端まで動かした場合、一覧の領域を上にスクロールする', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { card, region } = await renderMovableProducts();
      region.scrollTop = 300;

      grabAndMoveTo(card, 10);

      expect(region.scrollTop).toBeLessThan(300);
      fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 10 });
    });
  });
});

describe('キーボードで一覧をスクロールするためのフォーカス（issue #21・PR #29 のレビュー）', () => {
  /** 一覧の領域（リスト・アーカイブを表示するタブの中身）を返す。 */
  const getListRegion = () => screen.getByRole('tabpanel');

  /** 画面の更新が落ち着くまで少し待つ（後からフォーカスを動かす処理があっても反映させるため）。 */
  const waitForSettled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

  it('開いてリストを表示した場合、一覧の領域にフォーカスを置く', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: 'リストの商品' })] } }) });
    render(<App currentTime={currentTime} />);

    await screen.findByText('リストの商品');

    await waitFor(() => expect(getListRegion()).toHaveFocus());
  });

  it('ログインした後に一覧を表示した場合も、一覧の領域にフォーカスを置く', async () => {
    let status = { authenticationEnabled: true, accountExists: true, loggedIn: false };
    stubFetchRoutes({
      'GET /api/auth/status': () => ({ body: status }),
      'POST /api/auth/login': () => {
        status = { authenticationEnabled: true, accountExists: true, loggedIn: true };
        return { body: status };
      },
      'GET /api/products': () => ({ body: { products: [createProduct({ name: '一覧の商品' })] } }),
    });
    render(<App currentTime={currentTime} />);
    await userEvent.type(await screen.findByRole('textbox', { name: 'ID' }), 'owner');
    await userEvent.type(screen.getByLabelText('パスワード'), 'correct-horse');

    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));

    await screen.findByText('一覧の商品');
    await waitFor(() => expect(getListRegion()).toHaveFocus());
  });

  it('タブを押してアーカイブに切り替えた場合、押したタブにあるフォーカスを奪わない', async () => {
    stubFetchRoutes({
      'GET /api/products': () => ({
        body: { products: [createProduct({ id: 'product-2', name: 'アーカイブの商品', releaseMonth: '2026-10', status: 'purchased' })] },
      }),
    });
    render(<App currentTime={currentTime} />);
    const archiveTab = await screen.findByRole('tab', { name: 'アーカイブ' });

    await userEvent.click(archiveTab);
    await screen.findByText('アーカイブの商品');
    await waitForSettled();

    expect(archiveTab).toHaveFocus();
  });

  it('追加のモーダルを開いた場合、商品名の入力欄にあるフォーカスを奪わない', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: 'リストの商品' })] } }) });
    render(<App currentTime={currentTime} />);
    await screen.findByText('リストの商品');

    await userEvent.click(screen.getByRole('button', { name: '商品を追加' }));
    await waitForSettled();

    expect(within(screen.getByRole('dialog', { name: '商品を追加' })).getByLabelText('商品名')).toHaveFocus();
  });

  it('開いたときに延期の確認のモーダルを表示する場合、フォーカスをモーダルの後ろの一覧の領域に置かない', async () => {
    stubFetchRoutes({
      'GET /api/products': () => ({
        body: { products: [createProduct({ name: '確認待ちの商品', releaseMonth: '2026-10', status: 'purchased', deliveryConfirmationPending: true })] },
      }),
    });
    render(<App currentTime={currentTime} />);

    await screen.findByRole('dialog', { name: '発売月を過ぎた予約商品の確認' });
    await waitForSettled();

    expect(getListRegion()).not.toHaveFocus();
  });

  it('追加のモーダルを閉じた場合、一覧の領域にフォーカスを置く', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: 'リストの商品' })] } }) });
    render(<App currentTime={currentTime} />);
    await screen.findByText('リストの商品');
    await userEvent.click(screen.getByRole('button', { name: '商品を追加' }));

    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(getListRegion()).toHaveFocus());
  });

  it('カテゴリーの管理のモーダルを閉じた場合も、一覧の領域にフォーカスを置く', async () => {
    stubFetchRoutes({ 'GET /api/products': () => ({ body: { products: [createProduct({ name: 'リストの商品' })] } }) });
    render(<App currentTime={currentTime} />);
    await screen.findByText('リストの商品');
    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'カテゴリーの管理' }));
    const dialog = await screen.findByRole('dialog', { name: 'カテゴリーの管理' });

    await userEvent.click(getFooterButton(dialog, '閉じる'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(getListRegion()).toHaveFocus());
  });
});
