// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductDetailDialog } from '../../../client/components/ProductDetailDialog.tsx';
import type { CategoryResponse } from '../../../shared/categoryContract.ts';
import type { ProductListItem } from '../../../shared/productContract.ts';
import { getHeaderCloseButton, holdFetchRoute } from '../dialogCloseButtonQueries.ts';
import { stubFetchRoutes } from '../testFetchStub.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

/** 物品のカテゴリー（項目の指定は既定と同じ）。 */
const figureCategory: CategoryResponse = {
  id: 'action',
  name: '可動フィギュア',
  fields: ['shippingFee', 'maker', 'orderDeadline', 'cancelable'],
  otherExpenseLabel: 'その他費用',
};

/** 電子チケットのカテゴリー（送料・メーカー・受注期限を使わず、場所・開催日時・費用を使う）。 */
const ticketCategory: CategoryResponse = {
  id: 'ticket',
  name: '電子チケット',
  fields: ['location', 'eventPeriod', 'handlingFee', 'travelExpense', 'otherExpense'],
  otherExpenseLabel: 'グッズ代',
};

const categories = [figureCategory, ticketCategory];

/** テスト用の商品を作る。 */
function createProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'product-1',
    name: 'アクションフィギュア セカンド・フォーム',
    releaseMonth: '2026-12',
    status: 'reserved',
    cancelable: false,
    price: 2500,
    shippingFee: 660,
    orderDeadline: '2026-11-30',
    url: 'https://www.example.com/item/123',
    categoryId: 'action',
    categoryName: '可動フィギュア',
    maker: 'ホビーメーカー',
    note: null,
    location: null,
    handlingFee: null,
    travelExpense: null,
    otherExpense: null,
    eventStartsAt: null,
    eventEndsAt: null,
    discount: null,
    imageUrl: null,
    imageKind: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    deliveryConfirmationPending: false,
    cardImagePending: false,
    ...overrides,
  };
}

/** 電子チケットの商品を作る。 */
function createTicket(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return createProduct({
    id: 'ticket-1',
    name: 'アニバーサリーライブ 2日目 指定席',
    releaseMonth: '2027-01',
    status: 'purchased',
    price: 9800,
    shippingFee: null,
    orderDeadline: null,
    url: null,
    categoryId: 'ticket',
    categoryName: '電子チケット',
    maker: 'ライブ制作委員会',
    location: 'さいたまスーパーアリーナ',
    handlingFee: 880,
    travelExpense: 2800,
    eventStartsAt: '2027-01-24T08:00:00.000Z',
    eventEndsAt: '2027-01-24T11:30:00.000Z',
    ...overrides,
  });
}

/** 詳細画面に渡す、省略できる引数（アーカイブの商品では onRestoreRequested を渡す）。 */
type DetailProps = { readonly onRestoreRequested?: () => void };

/** 詳細画面を開く。 */
function renderDetail(product: ProductListItem, props: DetailProps = {}) {
  const handlers = {
    onClose: vi.fn(),
    onEditRequested: vi.fn(),
    onDeleted: vi.fn(),
    onStatusChanged: vi.fn(),
  };
  render(<ProductDetailDialog product={product} categories={categories} {...handlers} {...props} />);
  return handlers;
}

/** 詳細画面のモーダルを返す。 */
function getDetailDialog(): HTMLElement {
  return screen.getByRole('dialog', { name: '商品の詳細' });
}

/** 項目の一覧（dl）で、名前（dt）に対応する値（dd）を返す。 */
function getItemValue(label: string): HTMLElement {
  const term = within(getDetailDialog()).getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement) || value.tagName !== 'DD') throw new Error(`「${label}」の値（dd）がない`);
  return value;
}

/** 詳細画面で値がないことを示す印（読み上げでは「未入力」と伝わる）をすべて返す（issue #63）。 */
function getAllEmptyMarks(container: HTMLElement): HTMLElement[] {
  return within(container).getAllByRole('img', { name: '未入力' });
}

/**
 * 項目の値（dd）が「値がない」表示であることを確かめる（issue #63）。
 * 見た目は全角の「－」（U+FF0D）だけで、「未入力」の文字は出さず、読み上げでは「未入力」と伝わる。
 */
function expectEmptyValue(value: HTMLElement) {
  expect(value.textContent).toBe('\uFF0D');
  expect(getAllEmptyMarks(value)).toHaveLength(1);
  expect(getAllEmptyMarks(value)[0]).toHaveTextContent('\uFF0D');
}

/** 項目の一覧に、その名前の項目があるか。 */
function hasItem(label: string): boolean {
  return within(getDetailDialog()).queryByText(label, { selector: 'dt' }) !== null;
}

describe('商品の詳細画面の表示（issue #52）', () => {
  it('「商品の詳細」のモーダルとして開き、商品名・メーカー・ステータスを表示する', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ status: 'reserved', cancelable: true }));

    const dialog = getDetailDialog();
    expect(within(dialog).getByRole('heading', { name: 'アクションフィギュア セカンド・フォーム' })).toBeInTheDocument();
    expect(within(dialog).getByText('ホビーメーカー')).toBeInTheDocument();
    expect(within(dialog).getByText('予約済（キャンセル可）', { selector: ':not(option)' })).toBeInTheDocument();
  });

  it('画像がある場合、画像を大きく表示する（画面を開いているパスの下の API から読む）', () => {
    stubFetchRoutes({});
    window.history.replaceState(null, '', '/waders/');
    renderDetail(createProduct({ imageUrl: '/api/products/product-1/image?v=abc', imageKind: 'uploaded' }));

    expect(within(getDetailDialog()).getByRole('img', { name: '商品の画像' })).toHaveAttribute('src', '/waders/api/products/product-1/image?v=abc');
  });

  it('画像がない場合、商品の画像は表示しない（共通のアイコンを表示する）', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ imageUrl: null }));

    expect(within(getDetailDialog()).queryByRole('img', { name: '商品の画像' })).not.toBeInTheDocument();
  });

  it('画像を読み込めなかった場合、商品の画像を外して共通のアイコンにする', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ imageUrl: '/api/products/product-1/image?v=abc', imageKind: 'card' }));

    fireEvent.error(within(getDetailDialog()).getByRole('img', { name: '商品の画像' }));

    expect(within(getDetailDialog()).queryByRole('img', { name: '商品の画像' })).not.toBeInTheDocument();
  });

  it('物品の場合、カテゴリー・発売月・受注期限・購入先・備考を項目として表示し、値がない項目は「－」と示す（読み上げでは「未入力」）', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ note: null }));

    expect(getItemValue('カテゴリー')).toHaveTextContent('可動フィギュア');
    expect(getItemValue('発売月')).toHaveTextContent('2026/12');
    expect(getItemValue('受注期限')).toHaveTextContent('2026/11/30');
    expectEmptyValue(getItemValue('備考'));
    expect(hasItem('場所')).toBe(false);
    expect(hasItem('開催日時')).toBe(false);
  });

  it('購入先は、ドメイン名のリンクで、新しいタブで開く', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ url: 'https://www.example.com/item/123' }));

    const link = within(getItemValue('購入先')).getByRole('link', { name: 'www.example.com' });
    expect(link).toHaveAttribute('href', 'https://www.example.com/item/123');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('購入先がない場合、購入先は「－」と示し（読み上げでは「未入力」）、リンクは出さない', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ url: null }));

    expectEmptyValue(getItemValue('購入先'));
    expect(within(getItemValue('購入先')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('備考は、改行を保って表示する', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ note: '特典のポスター付き。\n発売日が延びたらメールが届く。' }));

    const note = getItemValue('備考');
    expect(note).toHaveTextContent('特典のポスター付き。');
    expect(note).toHaveTextContent('発売日が延びたらメールが届く。');
    expect(note.innerHTML).toMatch(/特典のポスター付き。(<br>|\n)発売日が延びたらメールが届く。/);
  });

  it('電子チケットの場合、場所・開催日時・終了日時（日本時間）を表示し、使わない受注期限は表示しない', () => {
    stubFetchRoutes({});
    renderDetail(createTicket());

    expect(getItemValue('カテゴリー')).toHaveTextContent('電子チケット');
    expect(getItemValue('発売月')).toHaveTextContent('2027/01');
    expect(getItemValue('場所')).toHaveTextContent('さいたまスーパーアリーナ');
    expect(getItemValue('開催日時')).toHaveTextContent('2027/01/24（日）17:00');
    expect(getItemValue('終了日時')).toHaveTextContent('2027/01/24（日）20:30');
    expect(hasItem('受注期限')).toBe(false);
  });

  it('カテゴリーで使わない項目でも、値が保存されている場合は表示する（編集のモーダルと同じ決まり）', () => {
    stubFetchRoutes({});
    renderDetail(createTicket({ orderDeadline: '2026-12-10' }));

    expect(getItemValue('受注期限')).toHaveTextContent('2026/12/10');
  });

  it('カテゴリーが未設定の場合、カテゴリーは今までどおり「未設定」と示し、「－」にはしない', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ categoryId: null, categoryName: null }));

    const category = getItemValue('カテゴリー');
    expect(category.textContent).toBe('未設定');
    expect(within(category).queryByRole('img', { name: '未入力' })).not.toBeInTheDocument();
  });

  it('受注期限が空の場合、受注期限は「－」と示す（読み上げでは「未入力」）', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ orderDeadline: null }));

    expectEmptyValue(getItemValue('受注期限'));
  });

  it('場所・開催日時・終了日時が空の場合、「－」と示す（読み上げでは「未入力」）', () => {
    stubFetchRoutes({});
    renderDetail(createTicket({ eventStartsAt: null, eventEndsAt: null, location: null }));

    expectEmptyValue(getItemValue('場所'));
    expectEmptyValue(getItemValue('開催日時'));
    expectEmptyValue(getItemValue('終了日時'));
  });

  it('値がない項目がある場合も、「未入力」の文字は画面に表示しない', () => {
    stubFetchRoutes({});
    renderDetail(createTicket({ price: null, eventStartsAt: null, eventEndsAt: null, location: null, url: null, note: null }));

    const dialog = getDetailDialog();
    expect(getAllEmptyMarks(dialog).length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/未入力/)).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('未入力');
  });
});

describe('詳細画面の金額（issue #52）', () => {
  it('送料と値引きがある場合、最終的な金額と、内訳を「（金額 ＋ 送料 − 値引き）」の形で表示する', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ price: 2500, shippingFee: 660, discount: 500 }));

    const dialog = getDetailDialog();
    expect(within(dialog).getByText('2,660円')).toBeInTheDocument();
    expect(within(dialog).getByText('（2,500円 ＋ 送料 660円 − 値引き 500円）')).toBeInTheDocument();
  });

  it('手数料・交通費（見込）・その他費用がある場合、内訳に含め、その他費用はカテゴリーで決めた名前で示す', () => {
    stubFetchRoutes({});
    renderDetail(createTicket({ price: 9800, handlingFee: 880, travelExpense: 2800, otherExpense: 3000 }));

    const dialog = getDetailDialog();
    expect(within(dialog).getByText('16,480円')).toBeInTheDocument();
    expect(within(dialog).getByText('（9,800円 ＋ 手数料 880円 ＋ 交通費（見込） 2,800円 ＋ グッズ代 3,000円）')).toBeInTheDocument();
  });

  it('費用も値引きもない（空または 0 円の）場合、内訳は出さず、金額だけを表示する', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ price: 18000, shippingFee: 0, discount: 0 }));

    const dialog = getDetailDialog();
    expect(within(dialog).getByText('18,000円')).toBeInTheDocument();
    expect(within(dialog).queryByText(/^（.*）$/)).not.toBeInTheDocument();
  });

  it('値引きが金額を上回る場合（送料までポイントで払った場合）も、最終的な金額は金額と費用の合計から値引きを引いた額にする', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ price: 1000, shippingFee: 500, discount: 1200 }));

    const dialog = getDetailDialog();
    expect(within(dialog).getByText('300円')).toBeInTheDocument();
    expect(within(dialog).getByText('（1,000円 ＋ 送料 500円 − 値引き 1,200円）')).toBeInTheDocument();
  });

  it('金額が未入力の場合、金額は「－」と示し（読み上げでは「未入力」）、「未入力」の文字や金額は表示しない', () => {
    stubFetchRoutes({});
    // ほかの項目には値を入れ、値がない印が金額だけになるようにする
    renderDetail(createProduct({ price: null, shippingFee: null, note: '予約の受付を待っている' }));

    const dialog = getDetailDialog();
    const marks = getAllEmptyMarks(dialog);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent(/^\uFF0D$/);
    expect(marks[0]?.closest('dd')).toBeNull();
    expect(dialog).not.toHaveTextContent('未入力');
    expect(within(dialog).queryByText(/円/)).not.toBeInTheDocument();
  });
});

describe('詳細画面からのステータスの変更（issue #52）', () => {
  it('ステータスのプルダウンで、検討中・予約済・予約済（キャンセル可）・購入済・未購入・キャンセルを選べ、今のステータスが選ばれている（キャンセルは issue #57）', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ status: 'reserved', cancelable: true }));

    const select = within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' });
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '検討中',
      '予約済',
      '予約済（キャンセル可）',
      '購入済',
      '未購入',
      'キャンセル',
    ]);
    expect(select).toHaveDisplayValue('予約済（キャンセル可）');
  });

  it.each([
    ['検討中', { status: 'considering' }],
    ['購入済', { status: 'purchased' }],
    ['未購入', { status: 'unpurchased' }],
    ['予約済', { status: 'reserved', cancelable: false }],
    ['予約済（キャンセル可）', { status: 'reserved', cancelable: true }],
  ])('「%s」を選んだ場合、その場で PATCH /api/products/:productId/status に JSON で送り、onStatusChanged に新しい商品を渡す', async (label, body) => {
    const product = createProduct({ status: label === '検討中' ? 'purchased' : 'considering', cancelable: false });
    const changed = createProduct({ status: body.status as ProductListItem['status'], cancelable: 'cancelable' in body ? body.cancelable : false });
    const { requests } = stubFetchRoutes({ 'PATCH /api/products/product-1/status': () => ({ body: changed }) });
    const { onStatusChanged } = renderDetail(product);

    await userEvent.selectOptions(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' }), label);

    await waitFor(() => expect(onStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'product-1', status: body.status })));
    expect(requests).toEqual([
      { method: 'PATCH', path: '/api/products/product-1/status', body, contentType: 'application/json' },
    ]);
  });

  it('保存できた場合、詳細画面の表示も新しいステータスにする', async () => {
    stubFetchRoutes({ 'PATCH /api/products/product-1/status': () => ({ body: createProduct({ status: 'purchased' }) }) });
    renderDetail(createProduct({ status: 'reserved' }));

    await userEvent.selectOptions(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' }), '購入済');

    await waitFor(() => expect(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' })).toHaveDisplayValue('購入済'));
    expect(within(getDetailDialog()).getByText('購入済', { selector: ':not(option)' })).toBeInTheDocument();
  });

  it('保存している間は、プルダウンを選べない', async () => {
    const { fetchMock } = stubFetchRoutes({ 'PATCH /api/products/product-1/status': () => ({ body: createProduct({ status: 'purchased' }) }) });
    holdFetchRoute(fetchMock, 'PATCH /api/products/product-1/status');
    renderDetail(createProduct({ status: 'reserved' }));

    await userEvent.selectOptions(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' }), '購入済');

    expect(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' })).toBeDisabled();
  });

  it('保存できなかった場合、変更できなかったことを表示し、プルダウンを元のステータスに戻し、onStatusChanged を呼ばない', async () => {
    stubFetchRoutes({
      'PATCH /api/products/product-1/status': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } }),
    });
    const { onStatusChanged } = renderDetail(createProduct({ status: 'reserved' }));

    await userEvent.selectOptions(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' }), '購入済');

    expect(await within(getDetailDialog()).findByRole('alert')).toHaveTextContent('ステータスを変更できませんでした。時間をおいて、もう一度お試しください。');
    expect(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' })).toHaveDisplayValue('予約済');
    expect(onStatusChanged).not.toHaveBeenCalled();
  });
});

describe('詳細画面の操作（issue #52）', () => {
  it('見出しの行の閉じるボタン（×）を押した場合、onClose を呼ぶ', async () => {
    stubFetchRoutes({});
    const { onClose } = renderDetail(createProduct());

    await userEvent.click(getHeaderCloseButton(getDetailDialog()));

    expect(onClose).toHaveBeenCalled();
  });

  it('Esc キーを押した場合、onClose を呼ぶ', () => {
    stubFetchRoutes({});
    const { onClose } = renderDetail(createProduct());

    fireEvent.keyDown(getDetailDialog(), { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('「編集」を押した場合、onEditRequested を呼ぶ', async () => {
    stubFetchRoutes({});
    const { onEditRequested, onClose } = renderDetail(createProduct());

    await userEvent.click(within(getDetailDialog()).getByRole('button', { name: '編集' }));

    expect(onEditRequested).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('下の端に「購入先を開く」ボタンは置かない', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ url: 'https://www.example.com/item/123' }));

    expect(within(getDetailDialog()).queryByRole('button', { name: /購入先を開く/ })).not.toBeInTheDocument();
    expect(within(getDetailDialog()).queryByRole('link', { name: /購入先を開く/ })).not.toBeInTheDocument();
  });

  it('「削除」を押した場合、確認を表示し、「削除する」で DELETE を送って onDeleted を呼ぶ', async () => {
    const { requests } = stubFetchRoutes({ 'DELETE /api/products/product-1': () => ({ status: 204 }) });
    const { onDeleted } = renderDetail(createProduct());

    await userEvent.click(within(getDetailDialog()).getByRole('button', { name: '削除' }));
    expect(screen.getByRole('alertdialog', { name: '商品を削除しますか？' })).toHaveTextContent('アクションフィギュア セカンド・フォーム');
    await userEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(requests).toEqual([expect.objectContaining({ method: 'DELETE', path: '/api/products/product-1' })]);
  });

  it('削除の確認で「削除しない」を押した場合、削除せず、詳細画面に戻る', async () => {
    const { requests } = stubFetchRoutes({});
    const { onDeleted } = renderDetail(createProduct());

    await userEvent.click(within(getDetailDialog()).getByRole('button', { name: '削除' }));
    await userEvent.click(screen.getByRole('button', { name: '削除しない' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(getDetailDialog()).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('削除できなかった場合、削除できなかったことを表示し、onDeleted を呼ばない', async () => {
    stubFetchRoutes({
      'DELETE /api/products/product-1': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } }),
    });
    const { onDeleted } = renderDetail(createProduct());

    await userEvent.click(within(getDetailDialog()).getByRole('button', { name: '削除' }));
    await userEvent.click(screen.getByRole('button', { name: '削除する' }));

    expect(await screen.findByText('削除できませんでした。時間をおいて、もう一度お試しください。')).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('onRestoreRequested を渡した場合（アーカイブの商品）、「リストに戻す」を表示し、押すと onRestoreRequested を呼ぶ', async () => {
    stubFetchRoutes({});
    const onRestoreRequested = vi.fn();
    renderDetail(createProduct({ releaseMonth: '2026-10', status: 'purchased' }), { onRestoreRequested });

    await userEvent.click(within(getDetailDialog()).getByRole('button', { name: 'リストに戻す' }));

    expect(onRestoreRequested).toHaveBeenCalled();
  });

  it('onRestoreRequested を渡さない場合（一覧の商品）、「リストに戻す」は表示しない', () => {
    stubFetchRoutes({});
    renderDetail(createProduct());

    expect(within(getDetailDialog()).queryByRole('button', { name: 'リストに戻す' })).not.toBeInTheDocument();
  });

  it('ステータスを保存している間は、閉じるボタン（×）・「編集」・「削除」を押せない', async () => {
    const { fetchMock } = stubFetchRoutes({ 'PATCH /api/products/product-1/status': () => ({ body: createProduct({ status: 'purchased' }) }) });
    holdFetchRoute(fetchMock, 'PATCH /api/products/product-1/status');
    renderDetail(createProduct({ status: 'reserved' }));

    await userEvent.selectOptions(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' }), '購入済');

    expect(getHeaderCloseButton(getDetailDialog())).toBeDisabled();
    expect(within(getDetailDialog()).getByRole('button', { name: '編集' })).toBeDisabled();
    expect(within(getDetailDialog()).getByRole('button', { name: '削除' })).toBeDisabled();
  });
});

describe('詳細画面のステータス「キャンセル」（issue #57）', () => {
  /** キャンセル（issue #57）。実装の前でも型チェックを通すため、文字列から変換して使う。 */
  const CANCELED_STATUS = 'canceled' as string as ProductListItem['status'];

  /** プルダウンの選択肢の表記の一覧。 */
  function listStatusOptionTexts(): (string | null)[] {
    const select = within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' });
    return within(select).getAllByRole('option').map((option) => option.textContent);
  }

  it.each([
    ['検討中', { status: 'considering', cancelable: false }],
    ['予約済', { status: 'reserved', cancelable: false }],
    ['予約済（キャンセル可）', { status: 'reserved', cancelable: true }],
    ['購入済', { status: 'purchased', cancelable: false }],
    ['未購入', { status: 'unpurchased', cancelable: false }],
  ] as const)('%s の商品で「キャンセル」を選んだ場合、その場で PATCH /api/products/:productId/status に { status: canceled } を送り、onStatusChanged に新しい商品を渡す', async (_label, fields) => {
    const changed = createProduct({ ...fields, status: CANCELED_STATUS });
    const { requests } = stubFetchRoutes({ 'PATCH /api/products/product-1/status': () => ({ body: changed }) });
    const { onStatusChanged } = renderDetail(createProduct(fields));

    expect(listStatusOptionTexts()).toContain('キャンセル');
    await userEvent.selectOptions(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' }), 'キャンセル');

    await waitFor(() => expect(onStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'product-1', status: 'canceled' })));
    expect(requests).toEqual([
      { method: 'PATCH', path: '/api/products/product-1/status', body: { status: 'canceled' }, contentType: 'application/json' },
    ]);
  });

  it('キャンセルの商品の場合、ステータスを「キャンセル」と表示し（キャンセルの見た目のクラス）、プルダウンでも「キャンセル」が選ばれている', () => {
    stubFetchRoutes({});
    renderDetail(createProduct({ status: CANCELED_STATUS, cancelable: true }));

    const badge = within(getDetailDialog()).queryByText('キャンセル', { selector: ':not(option)' });
    expect(badge).toHaveClass('detail-status--canceled');
    expect(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' })).toHaveDisplayValue('キャンセル');
  });

  it('キャンセルの商品で、ほかのステータス（検討中）を選んだ場合、そのステータスを送る', async () => {
    const { requests } = stubFetchRoutes({ 'PATCH /api/products/product-1/status': () => ({ body: createProduct({ status: 'considering' }) }) });
    renderDetail(createProduct({ status: CANCELED_STATUS }));

    expect(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' })).toHaveDisplayValue('キャンセル');
    await userEvent.selectOptions(within(getDetailDialog()).getByRole('combobox', { name: 'ステータス' }), '検討中');

    await waitFor(() => expect(requests).toEqual([
      { method: 'PATCH', path: '/api/products/product-1/status', body: { status: 'considering' }, contentType: 'application/json' },
    ]));
  });
});
