// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CategoryManagerDialog } from '../../../client/components/CategoryManagerDialog.tsx';
import type { ProductListItem } from '../../../shared/productContract.ts';
import { stubFetchRoutes, type StubRouteHandlers } from '../testFetchStub.ts';

/** 値引きなし（issue #50）。既存の商品・テストの既定の値として、フィクスチャに展開して加える。 */
const NO_DISCOUNT = { discount: null } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

let createdCount = 0;

/** テスト用の商品を作る。 */
function createProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  createdCount += 1;
  return {
    id: `product-${createdCount}`,
    name: `商品 ${createdCount}`,
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
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    deliveryConfirmationPending: false,
    cardImagePending: false,
    ...overrides,
  };
}

const scaleProduct = () => createProduct({ categoryId: 'scale', categoryName: 'スケールフィギュア' });
const actionProduct = () => createProduct({ categoryId: 'action', categoryName: '可動フィギュア' });
const removedProduct = () => createProduct({ categoryId: 'removed', categoryName: 'プライズ' });

/**
 * カテゴリーと商品の一覧を返すスタブで、管理のモーダルを開く。
 * @returns 記録されたリクエストと、閉じたときに呼ばれる関数
 */
async function openDialog(products: ProductListItem[], extraRoutes: StubRouteHandlers = {}) {
  const stub = stubFetchRoutes({ 'GET /api/products': () => ({ body: { products } }), ...extraRoutes });
  const onClose = vi.fn();
  render(<CategoryManagerDialog onClose={onClose} />);
  const dialog = screen.getByRole('dialog', { name: 'カテゴリーの管理' });
  await within(dialog).findByRole('group', { name: 'スケールフィギュア' });
  return { ...stub, onClose, dialog };
}

/** 状態を変えたリクエスト（GET 以外）。 */
function findChangingRequests(requests: { method: string }[]) {
  return requests.filter((recorded) => recorded.method !== 'GET');
}

/** GET のリクエストの数を数える。 */
function countGetRequests(requests: { method: string; path: string }[], path: string) {
  return requests.filter((recorded) => recorded.method === 'GET' && recorded.path === path).length;
}

describe('カテゴリーの一覧', () => {
  it('開いた場合、定義の並び順でカテゴリーの名前と、使っている商品の数（アーカイブの商品を含む）を表示する', async () => {
    const { dialog } = await openDialog([scaleProduct(), createProduct({ categoryId: 'scale', categoryName: 'スケールフィギュア', releaseMonth: '2026-09' })]);

    const groups = within(dialog).getAllByRole('group').map((group) => group.getAttribute('aria-label'));
    expect(groups.slice(0, 2)).toEqual(['スケールフィギュア', '可動フィギュア']);
    const scale = within(dialog).getByRole('group', { name: 'スケールフィギュア' });
    expect(within(scale).getByRole('textbox', { name: 'カテゴリー名' })).toHaveValue('スケールフィギュア');
    expect(within(scale).getByText('2件')).toBeInTheDocument();
    expect(within(within(dialog).getByRole('group', { name: '可動フィギュア' })).getByText('0件')).toBeInTheDocument();
  });

  it('変更はすぐに定義に保存されることを説明し、まとめて保存するボタンは置かない', async () => {
    const { dialog } = await openDialog([]);

    expect(dialog).toHaveTextContent(
      '変更はすぐにカテゴリーの定義（categories.json）に保存します。名前を変えると、そのカテゴリーの商品も新しい名前になります。',
    );
    expect(within(dialog).queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });

  it('定義に誤りがある場合、サーバーの理由と直し方を表示し、追加・改名・削除の欄を出さない', async () => {
    stubFetchRoutes({
      'GET /api/products': () => ({ body: { products: [] } }),
      'GET /api/categories': () => ({
        status: 503,
        body: { error: { code: 'CATEGORY_DEFINITION_INVALID', message: 'カテゴリーの定義（categories.json）に誤りがあります: JSON として読めません' } },
      }),
    });
    render(<CategoryManagerDialog onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'カテゴリーの管理' });

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('カテゴリーの定義（categories.json）に誤りがあります: JSON として読めません');
    expect(alert).toHaveTextContent('データのフォルダの categories.json を直してから、ページを読み込み直してください。');
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '追加' })).not.toBeInTheDocument();
  });
});

describe('追加', () => {
  it('名前を入力して「追加」を押した場合、POST /api/categories に名前を送り、読み込み直して表示し、入力欄を空にする', async () => {
    let categories = [
      { id: 'scale', name: 'スケールフィギュア' },
      { id: 'action', name: '可動フィギュア' },
    ];
    const { dialog, requests } = await openDialog([], {
      'GET /api/categories': () => ({ body: { categories } }),
      'POST /api/categories': () => {
        categories = [...categories, { id: 'plastic', name: 'プラモデル' }];
        return { status: 201, body: { id: 'plastic', name: 'プラモデル' } };
      },
    });

    await userEvent.type(within(dialog).getByRole('textbox', { name: '新しいカテゴリー' }), 'プラモデル');
    await userEvent.click(within(dialog).getByRole('button', { name: '追加' }));

    expect(await within(dialog).findByRole('group', { name: 'プラモデル' })).toBeInTheDocument();
    expect(findChangingRequests(requests)).toEqual([
      expect.objectContaining({ method: 'POST', path: '/api/categories', body: { name: 'プラモデル' }, contentType: 'application/json' }),
    ]);
    expect(within(dialog).getByRole('textbox', { name: '新しいカテゴリー' })).toHaveValue('');
  });

  it('名前の入力欄で Enter キーを押した場合も追加する', async () => {
    const { dialog, requests } = await openDialog([], {
      'POST /api/categories': () => ({ status: 201, body: { id: 'plastic', name: 'プラモデル' } }),
    });

    await userEvent.type(within(dialog).getByRole('textbox', { name: '新しいカテゴリー' }), 'プラモデル{Enter}');

    await waitFor(() => expect(findChangingRequests(requests)).toHaveLength(1));
  });

  it.each([
    ['空の', '', 'カテゴリー名を入力してください。'],
    ['50 文字を超える', 'あ'.repeat(51), 'カテゴリー名は 50 文字以内で入力してください。'],
  ])('名前が%s場合、検証の文言を表示し、送らない', async (_label, name, message) => {
    const { dialog, requests } = await openDialog([]);

    if (name !== '') await userEvent.type(within(dialog).getByRole('textbox', { name: '新しいカテゴリー' }), name);
    await userEvent.click(within(dialog).getByRole('button', { name: '追加' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(findChangingRequests(requests)).toEqual([]);
  });

  it('サーバーが名前の重複を返した場合、サーバーの文言を表示する', async () => {
    const { dialog } = await openDialog([], {
      'POST /api/categories': () => ({
        status: 409,
        body: {
          error: {
            code: 'CATEGORY_NAME_DUPLICATE',
            message: 'カテゴリー「可動フィギュア」はすでにあります。',
            fieldErrors: { name: 'カテゴリー「可動フィギュア」はすでにあります。' },
          },
        },
      }),
    });

    await userEvent.type(within(dialog).getByRole('textbox', { name: '新しいカテゴリー' }), '可動フィギュア');
    await userEvent.click(within(dialog).getByRole('button', { name: '追加' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('カテゴリー「可動フィギュア」はすでにあります。');
  });

  it('想定外の理由で失敗した場合、「カテゴリーを保存できませんでした。」と表示する', async () => {
    const { dialog } = await openDialog([], {
      'POST /api/categories': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: '内部の詳細' } } }),
    });

    await userEvent.type(within(dialog).getByRole('textbox', { name: '新しいカテゴリー' }), 'プラモデル');
    await userEvent.click(within(dialog).getByRole('button', { name: '追加' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('カテゴリーを保存できませんでした。時間をおいて、もう一度お試しください。');
    expect(alert).not.toHaveTextContent('内部の詳細');
  });
});

describe('改名', () => {
  it('「名前を変更」は名前を変えるまで押せず、変えて押した場合、PUT でそのカテゴリーの新しい名前を送り、読み込み直す', async () => {
    const { dialog, requests } = await openDialog([actionProduct()], {
      'PUT /api/categories/action': () => ({ body: { id: 'action', name: 'アクションフィギュア' } }),
    });
    const action = within(dialog).getByRole('group', { name: '可動フィギュア' });
    expect(within(action).getByRole('button', { name: '名前を変更' })).toBeDisabled();
    const productLoadCount = countGetRequests(requests, '/api/products');

    const nameField = within(action).getByRole('textbox', { name: 'カテゴリー名' });
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'アクションフィギュア');
    await userEvent.click(within(action).getByRole('button', { name: '名前を変更' }));

    await waitFor(() => expect(countGetRequests(requests, '/api/products')).toBe(productLoadCount + 1));
    expect(findChangingRequests(requests)).toEqual([
      expect.objectContaining({ method: 'PUT', path: '/api/categories/action', body: { name: 'アクションフィギュア' } }),
    ]);
  });

  it('保存する時点で定義から消えていた場合、サーバーの文言を表示し、最新の定義を読み込み直す', async () => {
    let categories = [
      { id: 'scale', name: 'スケールフィギュア' },
      { id: 'action', name: '可動フィギュア' },
    ];
    const { dialog } = await openDialog([], {
      'GET /api/categories': () => ({ body: { categories } }),
      'PUT /api/categories/action': () => {
        categories = [{ id: 'scale', name: 'スケールフィギュア' }];
        return { status: 404, body: { error: { code: 'CATEGORY_NOT_FOUND', message: 'カテゴリーが見つかりません。ページを読み込み直してください。' } } };
      },
    });
    const action = within(dialog).getByRole('group', { name: '可動フィギュア' });
    await userEvent.type(within(action).getByRole('textbox', { name: 'カテゴリー名' }), '2');

    await userEvent.click(within(action).getByRole('button', { name: '名前を変更' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('カテゴリーが見つかりません。ページを読み込み直してください。');
    await waitFor(() => expect(within(dialog).queryByRole('group', { name: '可動フィギュア' })).not.toBeInTheDocument());
  });
});

describe('削除', () => {
  it('商品が使っていないカテゴリーの「削除」を押した場合、確認せずに、移す先なし（null）で削除を送る', async () => {
    const { dialog, requests } = await openDialog([], { 'DELETE /api/categories/action': () => ({ status: 204 }) });

    await userEvent.click(within(within(dialog).getByRole('group', { name: '可動フィギュア' })).getByRole('button', { name: '削除' }));

    await waitFor(() =>
      expect(findChangingRequests(requests)).toEqual([
        expect.objectContaining({ method: 'DELETE', path: '/api/categories/action', body: { moveToCategoryId: null } }),
      ]),
    );
  });

  it('商品が使っているカテゴリーの「削除」を押した場合、商品の数を示して確認し、まだ送らない。移す先はほかの定義のカテゴリーから選べる', async () => {
    const { dialog, requests } = await openDialog([actionProduct(), actionProduct()], {
      'GET /api/categories': () => ({
        body: {
          categories: [
            { id: 'scale', name: 'スケールフィギュア' },
            { id: 'action', name: '可動フィギュア' },
            { id: 'plastic', name: 'プラモデル' },
          ],
        },
      }),
    });
    const action = within(dialog).getByRole('group', { name: '可動フィギュア' });

    await userEvent.click(within(action).getByRole('button', { name: '削除' }));

    expect(action).toHaveTextContent('「可動フィギュア」は 2 件の商品が使っています。商品をどうしますか？');
    const destination = within(action).getByRole('combobox', { name: '移す先' });
    expect(Array.from((destination as HTMLSelectElement).options).map((option) => option.text)).toEqual(['スケールフィギュア', 'プラモデル']);
    expect(destination).toHaveValue('scale');
    expect(findChangingRequests(requests)).toEqual([]);
  });

  it('選んだ移す先で「移して削除」を押した場合、その移す先で削除を送り、読み込み直す', async () => {
    const { dialog, requests } = await openDialog([actionProduct()], {
      'GET /api/categories': () => ({
        body: {
          categories: [
            { id: 'scale', name: 'スケールフィギュア' },
            { id: 'action', name: '可動フィギュア' },
            { id: 'plastic', name: 'プラモデル' },
          ],
        },
      }),
      'DELETE /api/categories/action': () => ({ status: 204 }),
    });
    const action = within(dialog).getByRole('group', { name: '可動フィギュア' });
    await userEvent.click(within(action).getByRole('button', { name: '削除' }));
    const productLoadCount = countGetRequests(requests, '/api/products');

    await userEvent.selectOptions(within(action).getByRole('combobox', { name: '移す先' }), 'plastic');
    await userEvent.click(within(action).getByRole('button', { name: '移して削除' }));

    await waitFor(() => expect(countGetRequests(requests, '/api/products')).toBe(productLoadCount + 1));
    expect(findChangingRequests(requests)).toEqual([
      expect.objectContaining({ method: 'DELETE', path: '/api/categories/action', body: { moveToCategoryId: 'plastic' } }),
    ]);
  });

  it('「カテゴリー未設定にして削除」を押した場合、移す先なし（null）で削除を送る', async () => {
    const { dialog, requests } = await openDialog([actionProduct()], { 'DELETE /api/categories/action': () => ({ status: 204 }) });
    const action = within(dialog).getByRole('group', { name: '可動フィギュア' });
    await userEvent.click(within(action).getByRole('button', { name: '削除' }));

    await userEvent.click(within(action).getByRole('button', { name: 'カテゴリー未設定にして削除' }));

    await waitFor(() =>
      expect(findChangingRequests(requests)).toEqual([
        expect.objectContaining({ method: 'DELETE', path: '/api/categories/action', body: { moveToCategoryId: null } }),
      ]),
    );
  });

  it('「やめる」を押した場合、何も送らずに確認を閉じる', async () => {
    const { dialog, requests } = await openDialog([actionProduct()]);
    const action = within(dialog).getByRole('group', { name: '可動フィギュア' });
    await userEvent.click(within(action).getByRole('button', { name: '削除' }));

    await userEvent.click(within(action).getByRole('button', { name: 'やめる' }));

    expect(within(action).queryByRole('button', { name: 'カテゴリー未設定にして削除' })).not.toBeInTheDocument();
    expect(findChangingRequests(requests)).toEqual([]);
  });

  it('ほかの定義のカテゴリーがない場合、移す先と「移して削除」を出さない', async () => {
    const { dialog } = await openDialog([scaleProduct()], {
      'GET /api/categories': () => ({ body: { categories: [{ id: 'scale', name: 'スケールフィギュア' }] } }),
    });
    const scale = within(dialog).getByRole('group', { name: 'スケールフィギュア' });

    await userEvent.click(within(scale).getByRole('button', { name: '削除' }));

    expect(within(scale).queryByRole('combobox', { name: '移す先' })).not.toBeInTheDocument();
    expect(within(scale).queryByRole('button', { name: '移して削除' })).not.toBeInTheDocument();
    expect(within(scale).getByRole('button', { name: 'カテゴリー未設定にして削除' })).toBeInTheDocument();
  });
});

describe('定義にないカテゴリーの確認', () => {
  it('定義にないカテゴリーの商品がない場合、定義にないカテゴリーの欄を出さない', async () => {
    const { dialog } = await openDialog([scaleProduct()]);

    expect(within(dialog).queryByRole('heading', { name: '定義にないカテゴリー' })).not.toBeInTheDocument();
  });

  it('定義にないカテゴリーの商品がある場合、名前（最後に保存した名前）と商品の数と、3 つの選択肢を表示する', async () => {
    const { dialog } = await openDialog([removedProduct(), removedProduct(), removedProduct(), scaleProduct()]);

    expect(within(dialog).getByRole('heading', { name: '定義にないカテゴリー' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('カテゴリーの定義にないカテゴリーを使っている商品があります。どうするかを選んでください。');
    const removed = within(dialog).getByRole('group', { name: 'プライズ（定義にない）' });
    expect(within(removed).getByText('3件')).toBeInTheDocument();
    expect(within(removed).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '定義に追加する',
      '別のカテゴリーに移す',
      'カテゴリー未設定にする',
    ]);
  });

  it('「定義に追加する」を押した場合、そのカテゴリーを定義に追加するよう送り、読み込み直す', async () => {
    const { dialog, requests } = await openDialog([createProduct({ categoryId: 'legacy:プライズ', categoryName: 'プライズ' })], {
      'POST /api/categories/legacy%3A%E3%83%97%E3%83%A9%E3%82%A4%E3%82%BA/add-to-definition': () => ({
        status: 201,
        body: { id: 'legacy:プライズ', name: 'プライズ' },
      }),
    });
    const productLoadCount = countGetRequests(requests, '/api/products');

    await userEvent.click(
      within(within(dialog).getByRole('group', { name: 'プライズ（定義にない）' })).getByRole('button', { name: '定義に追加する' }),
    );

    await waitFor(() => expect(countGetRequests(requests, '/api/products')).toBe(productLoadCount + 1));
    expect(findChangingRequests(requests)).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/api/categories/legacy%3A%E3%83%97%E3%83%A9%E3%82%A4%E3%82%BA/add-to-definition',
        contentType: 'application/json',
      }),
    ]);
  });

  it('「別のカテゴリーに移す」を押した場合、移す先を定義のカテゴリーから選ばせ、「移す」で送る', async () => {
    const { dialog, requests } = await openDialog([removedProduct()], {
      'POST /api/categories/removed/reassign-products': () => ({ status: 204 }),
    });
    const removed = within(dialog).getByRole('group', { name: 'プライズ（定義にない）' });

    await userEvent.click(within(removed).getByRole('button', { name: '別のカテゴリーに移す' }));
    const destination = within(removed).getByRole('combobox', { name: '移す先' });
    expect(Array.from((destination as HTMLSelectElement).options).map((option) => option.text)).toEqual(['スケールフィギュア', '可動フィギュア']);
    expect(findChangingRequests(requests)).toEqual([]);
    await userEvent.selectOptions(destination, 'action');
    await userEvent.click(within(removed).getByRole('button', { name: '移す' }));

    await waitFor(() =>
      expect(findChangingRequests(requests)).toEqual([
        expect.objectContaining({ method: 'POST', path: '/api/categories/removed/reassign-products', body: { moveToCategoryId: 'action' } }),
      ]),
    );
  });

  it('「カテゴリー未設定にする」を押した場合、移す先なし（null）で送る', async () => {
    const { dialog, requests } = await openDialog([removedProduct()], {
      'POST /api/categories/removed/reassign-products': () => ({ status: 204 }),
    });

    await userEvent.click(
      within(within(dialog).getByRole('group', { name: 'プライズ（定義にない）' })).getByRole('button', { name: 'カテゴリー未設定にする' }),
    );

    await waitFor(() =>
      expect(findChangingRequests(requests)).toEqual([
        expect.objectContaining({ method: 'POST', path: '/api/categories/removed/reassign-products', body: { moveToCategoryId: null } }),
      ]),
    );
  });

  it('定義に同じ名前のカテゴリーがあって追加できない場合、サーバーの文言を表示する', async () => {
    const { dialog } = await openDialog([removedProduct()], {
      'POST /api/categories/removed/add-to-definition': () => ({
        status: 409,
        body: { error: { code: 'CATEGORY_NAME_DUPLICATE', message: 'カテゴリー「プライズ」はすでにあります。' } },
      }),
    });

    await userEvent.click(
      within(within(dialog).getByRole('group', { name: 'プライズ（定義にない）' })).getByRole('button', { name: '定義に追加する' }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('カテゴリー「プライズ」はすでにあります。');
  });
});

describe('閉じる', () => {
  it('何も変えずに「閉じる」を押した場合、変更なし（false）で onClose を呼ぶ', async () => {
    const { dialog, onClose } = await openDialog([]);

    await userEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));

    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('変更した後に「閉じる」を押した場合、変更あり（true）で onClose を呼ぶ', async () => {
    const { dialog, onClose } = await openDialog([], {
      'POST /api/categories': () => ({ status: 201, body: { id: 'plastic', name: 'プラモデル' } }),
    });
    await userEvent.type(within(dialog).getByRole('textbox', { name: '新しいカテゴリー' }), 'プラモデル{Enter}');
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: '新しいカテゴリー' })).toHaveValue(''));

    await userEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));

    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('モーダルの中で Esc キーを押した場合、閉じる', async () => {
    const { dialog, onClose } = await openDialog([]);
    await userEvent.click(within(dialog).getByRole('textbox', { name: '新しいカテゴリー' }));

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledWith(false);
  });
});

describe('入力する項目の設定（issue #27）', () => {
  /** 選べる項目のチェックボックスの表記（並び順）。 */
  const FIELD_CHECKBOX_LABELS = ['送料', 'メーカー', '受注期限', 'キャンセル可', '場所', '開催日時・終了日時', '手数料', '交通費（見込）', 'その他費用'];

  /** 電子チケットのカテゴリーを含む定義を返すスタブで管理のモーダルを開き、電子チケットの「入力する項目」を開く。 */
  async function openTicketFieldSettings(extraRoutes: StubRouteHandlers = {}) {
    let categories = [
      { id: 'scale', name: 'スケールフィギュア', fields: ['shippingFee', 'maker', 'orderDeadline', 'cancelable'], otherExpenseLabel: 'その他費用' },
      { id: 'ticket', name: '電子チケット', fields: ['location', 'handlingFee'], otherExpenseLabel: 'ドリンク代' },
    ];
    const opened = await openDialog([], {
      'GET /api/categories': () => ({ body: { categories } }),
      'PATCH /api/categories/ticket/field-settings': (requestBody) => {
        const body = requestBody as { fields?: Record<string, boolean>; otherExpenseLabel?: string | null };
        const ticket = categories[1];
        if (ticket === undefined) return { status: 500 };
        const enabled = new Set(ticket.fields);
        for (const [field, isEnabled] of Object.entries(body.fields ?? {})) {
          if (isEnabled) enabled.add(field);
          else enabled.delete(field);
        }
        const updated = {
          ...ticket,
          fields: ['shippingFee', 'maker', 'orderDeadline', 'cancelable', 'location', 'eventPeriod', 'handlingFee', 'travelExpense', 'otherExpense'].filter((field) => enabled.has(field)),
          otherExpenseLabel: body.otherExpenseLabel === undefined ? ticket.otherExpenseLabel : (body.otherExpenseLabel ?? 'その他費用'),
        };
        categories = [categories[0] ?? ticket, updated];
        return { body: updated };
      },
      ...extraRoutes,
    });
    const ticket = within(opened.dialog).getByRole('group', { name: '電子チケット' });
    await userEvent.click(within(ticket).getByRole('button', { name: '入力する項目' }));
    return { ...opened, ticket };
  }

  it('カテゴリーの「入力する項目」は閉じた状態で表示し、押すと、選べる項目のチェックボックスと「その他費用」の名前を、今の設定で表示する', async () => {
    const { dialog, ticket } = await openTicketFieldSettings();

    expect(within(within(dialog).getByRole('group', { name: 'スケールフィギュア' })).getByRole('button', { name: '入力する項目' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(within(ticket).getByRole('button', { name: '入力する項目' })).toHaveAttribute('aria-expanded', 'true');
    const checkboxes = within(ticket).getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(FIELD_CHECKBOX_LABELS.length);
    FIELD_CHECKBOX_LABELS.forEach((label, index) => {
      const checkbox = within(ticket).getByRole('checkbox', { name: label });
      expect(checkboxes[index]).toBe(checkbox);
      expect(checkbox).toHaveProperty('checked', label === '場所' || label === '手数料');
    });
    expect(within(ticket).getByRole('textbox', { name: 'その他費用の名前' })).toHaveValue('ドリンク代');
  });

  it('選んだ項目だけを入力できること、値が保存されている項目は外しても表示することを説明する', async () => {
    const { ticket } = await openTicketFieldSettings();

    expect(ticket).toHaveTextContent(
      'チェックした項目を、このカテゴリーの商品の追加・編集で入力できます。チェックを外しても、値が保存されている商品では表示します。',
    );
  });

  it('項目のチェックを入れた場合、すぐにその項目だけを有効にする変更を送り、読み込み直した設定を表示する', async () => {
    const { ticket, requests } = await openTicketFieldSettings();

    await userEvent.click(within(ticket).getByRole('checkbox', { name: '交通費（見込）' }));

    await waitFor(() => expect(within(ticket).getByRole('checkbox', { name: '交通費（見込）' })).toBeChecked());
    expect(findChangingRequests(requests)).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: '/api/categories/ticket/field-settings',
        contentType: 'application/json',
        body: { fields: { travelExpense: true } },
      }),
    ]);
  });

  it('「開催日時・終了日時」のチェックを入れた場合、1 組の項目（eventPeriod）を有効にする変更を送る（PR #30 のレビュー）', async () => {
    const { ticket, requests } = await openTicketFieldSettings();

    await userEvent.click(within(ticket).getByRole('checkbox', { name: '開催日時・終了日時' }));

    await waitFor(() => expect(within(ticket).getByRole('checkbox', { name: '開催日時・終了日時' })).toBeChecked());
    expect(findChangingRequests(requests)).toEqual([expect.objectContaining({ body: { fields: { eventPeriod: true } } })]);
  });

  it('項目のチェックを外した場合、すぐにその項目だけを無効にする変更を送る', async () => {
    const { ticket, requests } = await openTicketFieldSettings();

    await userEvent.click(within(ticket).getByRole('checkbox', { name: '場所' }));

    await waitFor(() => expect(within(ticket).getByRole('checkbox', { name: '場所' })).not.toBeChecked());
    expect(findChangingRequests(requests)).toEqual([expect.objectContaining({ body: { fields: { location: false } } })]);
  });

  it('「費用の名前を変更」は名前を変えるまで押せず、変えて押した場合、その名前を送る', async () => {
    const { ticket, requests } = await openTicketFieldSettings();
    expect(within(ticket).getByRole('button', { name: '費用の名前を変更' })).toBeDisabled();

    const labelField = within(ticket).getByRole('textbox', { name: 'その他費用の名前' });
    await userEvent.clear(labelField);
    await userEvent.type(labelField, 'ドリンク代・グッズ代');
    await userEvent.click(within(ticket).getByRole('button', { name: '費用の名前を変更' }));

    await waitFor(() => expect(findChangingRequests(requests)).toHaveLength(1));
    expect(findChangingRequests(requests)[0]).toMatchObject({
      method: 'PATCH',
      path: '/api/categories/ticket/field-settings',
      body: { otherExpenseLabel: 'ドリンク代・グッズ代' },
    });
  });

  it('「その他費用」の名前の入力欄で Enter キーを押した場合も、名前を送る', async () => {
    const { ticket, requests } = await openTicketFieldSettings();

    await userEvent.type(within(ticket).getByRole('textbox', { name: 'その他費用の名前' }), '等{Enter}');

    await waitFor(() => expect(findChangingRequests(requests)).toHaveLength(1));
    expect(findChangingRequests(requests)[0]).toMatchObject({ body: { otherExpenseLabel: 'ドリンク代等' } });
  });

  it('「その他費用」の名前を空にして変更した場合、名前を戻す（null）変更を送り、「その他費用」と表示する', async () => {
    const { ticket, requests } = await openTicketFieldSettings();

    await userEvent.clear(within(ticket).getByRole('textbox', { name: 'その他費用の名前' }));
    await userEvent.click(within(ticket).getByRole('button', { name: '費用の名前を変更' }));

    await waitFor(() => expect(within(ticket).getByRole('textbox', { name: 'その他費用の名前' })).toHaveValue('その他費用'));
    expect(findChangingRequests(requests)).toEqual([expect.objectContaining({ body: { otherExpenseLabel: null } })]);
  });

  it('「その他費用」の名前が 20 文字を超える場合、文言を表示し、送らない', async () => {
    const { dialog, ticket, requests } = await openTicketFieldSettings();

    const labelField = within(ticket).getByRole('textbox', { name: 'その他費用の名前' });
    await userEvent.clear(labelField);
    await userEvent.type(labelField, 'あ'.repeat(21));
    await userEvent.click(within(ticket).getByRole('button', { name: '費用の名前を変更' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('その他費用の名前は 20 文字以内で入力してください。');
    expect(findChangingRequests(requests)).toEqual([]);
  });

  it('保存に失敗した場合（サーバーのエラー）、MSG-E-008 を表示し、読み込み直した設定を表示する', async () => {
    const { dialog, ticket } = await openTicketFieldSettings({
      'PATCH /api/categories/ticket/field-settings': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: '内部の詳細' } } }),
    });

    await userEvent.click(within(ticket).getByRole('checkbox', { name: '交通費（見込）' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('カテゴリーを保存できませんでした。時間をおいて、もう一度お試しください。');
    await waitFor(() => expect(within(ticket).getByRole('checkbox', { name: '交通費（見込）' })).not.toBeChecked());
  });

  it('設定を変えた後に「閉じる」を押した場合、変更あり（true）で onClose を呼ぶ', async () => {
    const { dialog, ticket, onClose } = await openTicketFieldSettings();
    await userEvent.click(within(ticket).getByRole('checkbox', { name: '交通費（見込）' }));
    await waitFor(() => expect(within(ticket).getByRole('checkbox', { name: '交通費（見込）' })).toBeChecked());

    await userEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));

    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('定義にないカテゴリーには、「入力する項目」を表示しない', async () => {
    const { dialog } = await openDialog([removedProduct()]);

    const removed = await within(dialog).findByRole('group', { name: 'プライズ（定義にない）' });
    expect(within(removed).queryByRole('button', { name: '入力する項目' })).not.toBeInTheDocument();
  });
});
