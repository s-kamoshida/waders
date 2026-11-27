// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductEditorDialog } from '../../../client/components/ProductEditorDialog.tsx';
import type { CategoryResponse } from '../../../shared/categoryContract.ts';
import type { ProductResponse } from '../../../shared/productContract.ts';
import { stubFetchRoutes } from '../testFetchStub.ts';

// 画像の縮小（canvas）は jsdom では動かないため、縮小した結果を決まった値にする（issue #41）
vi.mock('../../../client/productImagePreparation.ts', () => ({
  prepareProductImage: vi.fn(async (file: File) => {
    if (file.name === 'broken.jpg') throw new Error('画像として読めない');
    return { data: `PREPARED-${file.name}`, width: 800, height: 600 };
  }),
  drawProductImagePreview: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 項目の指定がないカテゴリーで有効な、選べる項目（既定。issue #27）。 */
const DEFAULT_ENABLED_FIELDS: CategoryResponse['fields'] = ['shippingFee', 'maker', 'orderDeadline', 'cancelable'];

/** 既定の項目の設定のカテゴリー（物品）。 */
const figureCategory: CategoryResponse = { id: 'scale', name: 'スケールフィギュア', fields: DEFAULT_ENABLED_FIELDS, otherExpenseLabel: 'その他費用' };
const actionCategory: CategoryResponse = { id: 'action', name: '可動フィギュア', fields: DEFAULT_ENABLED_FIELDS, otherExpenseLabel: 'その他費用' };

/** 場所と費用（issue #26）が未入力の送信の本文。 */
const EMPTY_TICKET_FIELDS = { location: null, handlingFee: null, travelExpense: null, otherExpense: null, eventStartsAt: null, eventEndsAt: null };

/** テスト用の保存済みの商品を作る。 */
function createProduct(overrides: Partial<ProductResponse> = {}): ProductResponse {
  return {
    id: 'product-1',
    name: 'アクションフィギュア セカンド・フォーム',
    releaseMonth: '2026-12',
    status: 'reserved',
    cancelable: true,
    price: 13200,
    shippingFee: 800,
    orderDeadline: '2026-11-30',
    url: 'https://shop.example.jp/item/1',
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
    imageUrl: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('商品の追加', () => {
  it('追加の場合、発売月の既定は当月、ステータスの既定は検討中で、削除ボタンはない', () => {
    stubFetchRoutes({});
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: '商品を追加' })).toBeInTheDocument();
    expect(screen.getByLabelText('発売月')).toHaveValue('2026-11');
    expect(screen.getByLabelText('ステータス')).toHaveValue('considering');
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
  });

  it('ステータスは検討中・予約済・購入済・未購入の4つから選べる', () => {
    stubFetchRoutes({});
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    const options = Array.from((screen.getByLabelText('ステータス') as HTMLSelectElement).options).map((option) => option.text);
    expect(options).toEqual(['検討中', '予約済', '購入済', '未購入']);
  });

  it('入力して保存した場合、入力した値を POST /api/products に JSON で送り、onSaved を呼ぶ', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
    });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア セカンド・フォーム');
    fireEvent.change(screen.getByLabelText('発売月'), { target: { value: '2026-12' } });
    await userEvent.selectOptions(screen.getByLabelText('ステータス'), 'reserved');
    await userEvent.click(screen.getByLabelText('キャンセル可'));
    await userEvent.type(screen.getByLabelText('金額（税込）'), '13200');
    await userEvent.type(screen.getByLabelText('送料（税込）'), '800');
    fireEvent.change(screen.getByLabelText('受注期限'), { target: { value: '2026-11-30' } });
    await userEvent.type(screen.getByLabelText('購入先の URL'), 'https://shop.example.jp/item/1');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/products',
        contentType: 'application/json',
        body: {
          name: 'アクションフィギュア セカンド・フォーム',
          releaseMonth: '2026-12',
          status: 'reserved',
          cancelable: true,
          price: 13200,
          shippingFee: 800,
          orderDeadline: '2026-11-30',
          url: 'https://shop.example.jp/item/1',
          categoryId: null,
          maker: null,
          note: null,
          ...EMPTY_TICKET_FIELDS,
        },
      },
    ]);
  });

  it('任意の項目を空のまま保存した場合、未入力（null）として送る', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
    });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('商品名'), '名前だけの商品');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[0]?.body).toEqual({
      name: '名前だけの商品',
      releaseMonth: '2026-11',
      status: 'considering',
      cancelable: false,
      price: null,
      shippingFee: null,
      orderDeadline: null,
      url: null,
      categoryId: null,
      maker: null,
      note: null,
      ...EMPTY_TICKET_FIELDS,
    });
  });

  it('商品名が空のまま保存しようとした場合、エラーの文言を表示し、送信しない', async () => {
    const { requests } = stubFetchRoutes({});
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('商品名を入力してください。')).toBeInTheDocument();
    expect(requests).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('金額が範囲外の場合、エラーの文言を表示し、送信しない', async () => {
    const { requests } = stubFetchRoutes({});
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('商品名'), '高すぎる商品');
    await userEvent.type(screen.getByLabelText('金額（税込）'), '10000000');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('金額は 9,999,999 円以下で入力してください。')).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('サーバーが入力の誤りを返した場合、その文言を表示し、onSaved を呼ばない', async () => {
    stubFetchRoutes({
      'POST /api/products': () => ({
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: '入力に誤りがあります。', fieldErrors: { url: 'URL は http:// または https:// で始まるものを入力してください。' } } },
      }),
    });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('商品名'), '商品');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('URL は http:// または https:// で始まるものを入力してください。')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('保存に失敗した場合（サーバーのエラー）、失敗したことを表示し、入力を残す', async () => {
    stubFetchRoutes({
      'POST /api/products': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'サーバーでエラーが発生しました。' } } }),
    });
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('商品名'), '保存できない商品');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('保存できませんでした。');
    expect(screen.getByLabelText('商品名')).toHaveValue('保存できない商品');
  });

  it('キャンセルした場合、送信せずに onClose を呼ぶ', async () => {
    const { requests } = stubFetchRoutes({});
    const onClose = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={onClose} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(onClose).toHaveBeenCalled();
    expect(requests).toEqual([]);
  });
});

describe('商品の編集', () => {
  it('編集の場合、保存済みの値を入力欄に表示する', () => {
    stubFetchRoutes({});
    render(<ProductEditorDialog mode={{ kind: 'edit', product: createProduct() }} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: '商品を編集' })).toBeInTheDocument();
    expect(screen.getByLabelText('商品名')).toHaveValue('アクションフィギュア セカンド・フォーム');
    expect(screen.getByLabelText('発売月')).toHaveValue('2026-12');
    expect(screen.getByLabelText('ステータス')).toHaveValue('reserved');
    expect(screen.getByLabelText('キャンセル可')).toBeChecked();
    expect(screen.getByLabelText('金額（税込）')).toHaveValue(13200);
    expect(screen.getByLabelText('送料（税込）')).toHaveValue(800);
    expect(screen.getByLabelText('受注期限')).toHaveValue('2026-11-30');
    expect(screen.getByLabelText('購入先の URL')).toHaveValue('https://shop.example.jp/item/1');
  });

  it('保存した場合、PUT /api/products/:id に送り、onSaved を呼ぶ', async () => {
    const { requests } = stubFetchRoutes({
      'PUT /api/products/product-1': () => ({ body: createProduct({ status: 'considering' }) }),
    });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'edit', product: createProduct() }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.selectOptions(screen.getByLabelText('ステータス'), 'considering');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'PUT', path: '/api/products/product-1', body: { status: 'considering' } });
  });
});

describe('商品の削除', () => {
  it('削除を押した場合、確認を表示し、「削除する」で DELETE を送って onSaved を呼ぶ', async () => {
    const { requests } = stubFetchRoutes({
      'DELETE /api/products/product-1': () => ({ status: 204 }),
    });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'edit', product: createProduct() }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(screen.getByRole('alertdialog', { name: '商品を削除しますか？' })).toHaveTextContent('アクションフィギュア セカンド・フォーム');
    expect(requests).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests).toEqual([{ method: 'DELETE', path: '/api/products/product-1', body: null, contentType: 'application/json' }]);
  });

  it('確認でキャンセルした場合、削除しない', async () => {
    const { requests } = stubFetchRoutes({});
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'edit', product: createProduct() }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole('button', { name: '削除' }));
    await userEvent.click(screen.getByRole('button', { name: '削除しない' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(requests).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('メーカーと備考（issue #18）', () => {
  it('メーカーを入力でき、渡された候補を入力の候補として出す', () => {
    stubFetchRoutes({});
    render(
      <ProductEditorDialog
        mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        makerSuggestions={['メーカーA', 'メーカーB']}
      />,
    );

    const makerInput = screen.getByLabelText('メーカー');
    const suggestionList = document.getElementById(makerInput.getAttribute('list') ?? '');
    expect(Array.from(suggestionList?.querySelectorAll('option') ?? []).map((option) => option.value)).toEqual(['メーカーA', 'メーカーB']);
  });

  it('メーカーと複数行の備考を入力して保存した場合、その値を送る', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
    });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.type(screen.getByLabelText('メーカー'), 'メーカーA');
    await userEvent.type(screen.getByLabelText('備考'), '初回特典付き{Enter}分割で届く');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[0]?.body).toMatchObject({ maker: 'メーカーA', note: '初回特典付き\n分割で届く' });
  });

  it('編集の場合、保存済みのメーカーと備考を表示する', () => {
    stubFetchRoutes({});
    render(
      <ProductEditorDialog
        mode={{ kind: 'edit', product: createProduct({ maker: 'メーカーA', note: '初回特典付き\n分割で届く' }) }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('メーカー')).toHaveValue('メーカーA');
    expect(screen.getByLabelText('備考')).toHaveValue('初回特典付き\n分割で届く');
  });

  it.each([
    ['メーカー', 'あ'.repeat(101), 'メーカーは 100 文字以内で入力してください。'],
    ['備考', 'あ'.repeat(1001), '備考は 1,000 文字以内で入力してください。'],
  ])('%s が上限の文字数を超える場合、文言を表示し、送信しない', async (label, value, message) => {
    const { requests } = stubFetchRoutes({});
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('「保存して続けて追加」で保存した場合、メーカーと備考も空に戻す', async () => {
    stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
    });
    const onSavedAndContinued = vi.fn();
    render(
      <ProductEditorDialog
        mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onSavedAndContinued={onSavedAndContinued}
      />,
    );

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.type(screen.getByLabelText('メーカー'), 'メーカーA');
    await userEvent.type(screen.getByLabelText('備考'), '初回特典付き');
    await userEvent.click(screen.getByRole('button', { name: '保存方法を選ぶ' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: '保存して続けて追加' }));
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));
    await waitFor(() => expect(onSavedAndContinued).toHaveBeenCalled());

    expect(screen.getByLabelText('メーカー')).toHaveValue('');
    expect(screen.getByLabelText('備考')).toHaveValue('');
  });
});

describe('カテゴリー（issue #10）', () => {
  const categories = [figureCategory, actionCategory];

  /** プルダウンの選択肢の表記を返す。 */
  function listCategoryOptions(): string[] {
    return Array.from((screen.getByLabelText('カテゴリー') as HTMLSelectElement).options).map((option) => option.text);
  }

  it('追加の場合、カテゴリーを「未設定」と定義の並び順から選べ、既定は「未設定」', () => {
    stubFetchRoutes({});
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={vi.fn()} categories={categories} />);

    expect(listCategoryOptions()).toEqual(['未設定', 'スケールフィギュア', '可動フィギュア']);
    expect(screen.getByLabelText('カテゴリー')).toHaveDisplayValue('未設定');
  });

  it('カテゴリーを選んで保存した場合、その ID を送る', async () => {
    const { requests } = stubFetchRoutes({ 'POST /api/products': () => ({ status: 201, body: createProduct() }) });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} categories={categories} />);

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), '可動フィギュア');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[0]?.body).toMatchObject({ categoryId: 'action' });
  });

  it('編集の場合、保存済みのカテゴリーを選んだ状態で表示する', () => {
    stubFetchRoutes({});
    render(
      <ProductEditorDialog
        mode={{ kind: 'edit', product: createProduct({ categoryId: 'action', categoryName: '可動フィギュア' }) }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        categories={categories}
      />,
    );

    expect(screen.getByLabelText('カテゴリー')).toHaveDisplayValue('可動フィギュア');
  });

  it('定義にないカテゴリーの商品を編集する場合、「名前（定義にない）」を選んだ状態で表示し、変えずに保存するとそのまま送る', async () => {
    const { requests } = stubFetchRoutes({ 'PUT /api/products/product-1': () => ({ body: createProduct() }) });
    const onSaved = vi.fn();
    render(
      <ProductEditorDialog
        mode={{ kind: 'edit', product: createProduct({ categoryId: 'legacy', categoryName: '旧カテゴリー' }) }}
        onClose={vi.fn()}
        onSaved={onSaved}
        categories={categories}
      />,
    );

    expect(listCategoryOptions()).toEqual(['未設定', 'スケールフィギュア', '可動フィギュア', '旧カテゴリー（定義にない）']);
    expect(screen.getByLabelText('カテゴリー')).toHaveDisplayValue('旧カテゴリー（定義にない）');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[0]?.body).toMatchObject({ categoryId: 'legacy' });
  });

  it('カテゴリーの定義が読めない場合（categories が null）、カテゴリーを変更できず、理由を表示し、保存済みのカテゴリーのまま送る', async () => {
    const { requests } = stubFetchRoutes({ 'PUT /api/products/product-1': () => ({ body: createProduct() }) });
    const onSaved = vi.fn();
    render(
      <ProductEditorDialog
        mode={{ kind: 'edit', product: createProduct({ categoryId: 'action', categoryName: '可動フィギュア' }) }}
        onClose={vi.fn()}
        onSaved={onSaved}
        categories={null}
      />,
    );

    expect(screen.getByLabelText('カテゴリー')).toBeDisabled();
    expect(screen.getByLabelText('カテゴリー')).toHaveDisplayValue('可動フィギュア');
    expect(screen.getByText('カテゴリーの定義に誤りがあるため、カテゴリーは変更できません。')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[0]?.body).toMatchObject({ categoryId: 'action' });
  });

  it('「保存して続けて追加」で保存した場合、カテゴリーは残す', async () => {
    stubFetchRoutes({ 'POST /api/products': () => ({ status: 201, body: createProduct() }) });
    const onSavedAndContinued = vi.fn();
    render(
      <ProductEditorDialog
        mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onSavedAndContinued={onSavedAndContinued}
        categories={categories}
      />,
    );

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), '可動フィギュア');
    await userEvent.click(screen.getByRole('button', { name: '保存方法を選ぶ' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: '保存して続けて追加' }));
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));
    await waitFor(() => expect(onSavedAndContinued).toHaveBeenCalled());

    expect(screen.getByLabelText('カテゴリー')).toHaveDisplayValue('可動フィギュア');
  });
});

describe('連続追加（issue #16）', () => {
  /** 追加のモーダルを、商品名と全項目を入力した状態にする。 */
  async function fillAllFields(name: string) {
    await userEvent.type(screen.getByLabelText('商品名'), name);
    fireEvent.change(screen.getByLabelText('発売月'), { target: { value: '2027-01' } });
    await userEvent.selectOptions(screen.getByLabelText('ステータス'), 'reserved');
    await userEvent.click(screen.getByLabelText('キャンセル可'));
    await userEvent.type(screen.getByLabelText('金額（税込）'), '13200');
    await userEvent.type(screen.getByLabelText('送料（税込）'), '800');
    fireEvent.change(screen.getByLabelText('受注期限'), { target: { value: '2026-11-30' } });
    await userEvent.type(screen.getByLabelText('購入先の URL'), 'https://shop.example.jp/item/1');
  }

  /** 保存ボタンの横のプルダウンで、保存の方法を選ぶ。 */
  async function chooseSaveMethod(label: '保存' | '保存して続けて追加') {
    await userEvent.click(screen.getByRole('button', { name: '保存方法を選ぶ' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: label }));
  }

  /** 追加のモーダルを表示する。 */
  function renderCreateDialog(callbacks: { onSaved?: () => void; onSavedAndContinued?: () => void } = {}) {
    render(
      <ProductEditorDialog
        mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }}
        onClose={vi.fn()}
        onSaved={callbacks.onSaved ?? vi.fn()}
        onSavedAndContinued={callbacks.onSavedAndContinued ?? vi.fn()}
      />,
    );
  }

  it('追加の場合は保存ボタンの横に保存の方法のプルダウンを表示し、編集の場合は表示しない', () => {
    stubFetchRoutes({});
    const { unmount } = render(
      <ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={vi.fn()} onSavedAndContinued={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: '保存方法を選ぶ' })).toHaveAttribute('aria-haspopup', 'menu');
    unmount();

    render(<ProductEditorDialog mode={{ kind: 'edit', product: createProduct() }} onClose={vi.fn()} onSaved={vi.fn()} onSavedAndContinued={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '保存方法を選ぶ' })).not.toBeInTheDocument();
  });

  it('プルダウンを開いた場合、「保存」「保存して続けて追加」を表示し、今の方法（最初は「保存」）に印を付ける', async () => {
    stubFetchRoutes({});
    renderCreateDialog();

    await userEvent.click(screen.getByRole('button', { name: '保存方法を選ぶ' }));

    expect(screen.getByRole('button', { name: '保存方法を選ぶ' })).toHaveAttribute('aria-expanded', 'true');
    const items = within(screen.getByRole('menu')).getAllByRole('menuitemradio');
    expect(items.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['保存', 'true'],
      ['保存して続けて追加', 'false'],
    ]);
  });

  it('「保存して続けて追加」を選んだ場合、保存はせずにプルダウンを閉じ、保存ボタンの表示を「保存して続けて追加」にする', async () => {
    const { requests } = stubFetchRoutes({});
    renderCreateDialog();

    await chooseSaveMethod('保存して続けて追加');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存して続けて追加' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('プルダウンを Esc キーで閉じた場合、モーダルは閉じない', async () => {
    stubFetchRoutes({});
    const onClose = vi.fn();
    render(
      <ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={onClose} onSaved={vi.fn()} onSavedAndContinued={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: '保存方法を選ぶ' }));
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '商品を追加' })).toBeInTheDocument();
  });

  it('「保存して続けて追加」で保存した場合、onSavedAndContinued を呼び、モーダルを開いたまま、保存したことを表示する', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct({ name: '1つ目の商品' }) }),
    });
    const onSaved = vi.fn();
    const onSavedAndContinued = vi.fn();
    renderCreateDialog({ onSaved, onSavedAndContinued });

    await fillAllFields('1つ目の商品');
    await chooseSaveMethod('保存して続けて追加');
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));

    await waitFor(() => expect(onSavedAndContinued).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: '商品を追加' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('「1つ目の商品」を追加しました。');
  });

  it('続けて追加する場合、商品名・金額・送料・URL を空に戻し、発売月・ステータス・キャンセル可・受注期限を残し、商品名に入力位置を置く', async () => {
    stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct({ name: '1つ目の商品' }) }),
    });
    const onSavedAndContinued = vi.fn();
    renderCreateDialog({ onSavedAndContinued });

    await fillAllFields('1つ目の商品');
    await chooseSaveMethod('保存して続けて追加');
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));
    await waitFor(() => expect(onSavedAndContinued).toHaveBeenCalled());

    expect(screen.getByLabelText('商品名')).toHaveValue('');
    expect(screen.getByLabelText('金額（税込）')).toHaveValue(null);
    expect(screen.getByLabelText('送料（税込）')).toHaveValue(null);
    expect(screen.getByLabelText('購入先の URL')).toHaveValue('');
    expect(screen.getByLabelText('発売月')).toHaveValue('2027-01');
    expect(screen.getByLabelText('ステータス')).toHaveValue('reserved');
    expect(screen.getByLabelText('キャンセル可')).toBeChecked();
    expect(screen.getByLabelText('受注期限')).toHaveValue('2026-11-30');
    expect(screen.getByLabelText('商品名')).toHaveFocus();
  });

  it('選んだ方法は保たれ、2 つ目も選び直さずに「保存して続けて追加」で保存でき、残した値とともに送る', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
    });
    const onSavedAndContinued = vi.fn();
    renderCreateDialog({ onSavedAndContinued });
    await fillAllFields('1つ目の商品');
    await chooseSaveMethod('保存して続けて追加');
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));
    await waitFor(() => expect(onSavedAndContinued).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByLabelText('商品名'), '2つ目の商品');
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));

    await waitFor(() => expect(onSavedAndContinued).toHaveBeenCalledTimes(2));
    expect(requests[1]?.body).toEqual({
      name: '2つ目の商品',
      releaseMonth: '2027-01',
      status: 'reserved',
      cancelable: true,
      price: null,
      shippingFee: null,
      orderDeadline: '2026-11-30',
      url: null,
      categoryId: null,
      maker: null,
      note: null,
      ...EMPTY_TICKET_FIELDS,
    });
  });

  it('続けて入力した後に「保存」に戻して保存した場合、onSaved を呼ぶ', async () => {
    stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
    });
    const onSaved = vi.fn();
    const onSavedAndContinued = vi.fn();
    renderCreateDialog({ onSaved, onSavedAndContinued });
    await fillAllFields('1つ目の商品');
    await chooseSaveMethod('保存して続けて追加');
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));
    await waitFor(() => expect(onSavedAndContinued).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText('商品名'), '最後の商品');
    await chooseSaveMethod('保存');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSavedAndContinued).toHaveBeenCalledTimes(1);
  });

  it('「保存して続けて追加」で入力に誤りがある場合、エラーの文言を表示し、送信せず、入力を残す', async () => {
    const { requests } = stubFetchRoutes({});
    const onSavedAndContinued = vi.fn();
    renderCreateDialog({ onSavedAndContinued });

    await userEvent.type(screen.getByLabelText('金額（税込）'), '13200');
    await chooseSaveMethod('保存して続けて追加');
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));

    expect(screen.getByText('商品名を入力してください。')).toBeInTheDocument();
    expect(screen.getByLabelText('金額（税込）')).toHaveValue(13200);
    expect(requests).toEqual([]);
    expect(onSavedAndContinued).not.toHaveBeenCalled();
  });

  it('「保存して続けて追加」で保存に失敗した場合、失敗したことを表示し、入力を残す', async () => {
    stubFetchRoutes({
      'POST /api/products': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } }),
    });
    const onSavedAndContinued = vi.fn();
    renderCreateDialog({ onSavedAndContinued });

    await userEvent.type(screen.getByLabelText('商品名'), '保存できない商品');
    await chooseSaveMethod('保存して続けて追加');
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('保存できませんでした。');
    expect(screen.getByLabelText('商品名')).toHaveValue('保存できない商品');
    expect(onSavedAndContinued).not.toHaveBeenCalled();
  });
});

describe('場所と費用・カテゴリーごとの入力項目（issue #26・#27）', () => {
  /** 電子チケットのカテゴリー（送料・メーカー・受注期限・キャンセル可を使わず、場所と費用を使う。その他費用の名前は「ドリンク代」）。 */
  const ticketCategory: CategoryResponse = {
    id: 'ticket',
    name: '電子チケット',
    fields: ['location', 'handlingFee', 'travelExpense', 'otherExpense'],
    otherExpenseLabel: 'ドリンク代',
  };
  /** その他費用だけを使い、名前を変えていないカテゴリー。 */
  const otherExpenseOnlyCategory: CategoryResponse = { id: 'goods', name: 'グッズ', fields: ['otherExpense'], otherExpenseLabel: 'その他費用' };
  const categories = [figureCategory, ticketCategory, otherExpenseOnlyCategory];

  /** 常に表示する入力欄。 */
  const ALWAYS_SHOWN_LABELS = ['商品名', 'カテゴリー', '発売月', 'ステータス', '金額（税込）', '購入先の URL', '備考'];
  /** 既定の項目の設定で表示する、選べる項目の入力欄。 */
  const FIGURE_FIELD_LABELS = ['送料（税込）', 'メーカー', '受注期限', 'キャンセル可'];
  /** 電子チケットのカテゴリーで表示する、選べる項目の入力欄。 */
  const TICKET_FIELD_LABELS = ['場所', '手数料', '交通費（見込）', 'ドリンク代'];

  /** その表記の入力欄があるか。 */
  function hasField(label: string): boolean {
    return screen.queryByLabelText(label) !== null;
  }

  /** 追加のモーダルを表示する。 */
  function renderCreateDialog(props: { onSaved?: () => void; onSavedAndContinued?: () => void; categories?: readonly CategoryResponse[] | null } = {}) {
    render(
      <ProductEditorDialog
        mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }}
        onClose={vi.fn()}
        onSaved={props.onSaved ?? vi.fn()}
        onSavedAndContinued={props.onSavedAndContinued}
        categories={props.categories === undefined ? categories : props.categories}
      />,
    );
  }

  /** 編集のモーダルを表示する。 */
  function renderEditDialog(product: ProductResponse, props: { onSaved?: () => void; categories?: readonly CategoryResponse[] | null } = {}) {
    render(
      <ProductEditorDialog
        mode={{ kind: 'edit', product }}
        onClose={vi.fn()}
        onSaved={props.onSaved ?? vi.fn()}
        categories={props.categories === undefined ? categories : props.categories}
      />,
    );
  }

  /** 選べる項目がすべて未入力の、保存済みの商品を作る。 */
  function createPlainProduct(overrides: Partial<ProductResponse> = {}): ProductResponse {
    return createProduct({ cancelable: false, shippingFee: null, orderDeadline: null, maker: null, ...overrides });
  }

  describe('追加', () => {
    it('カテゴリーが「未設定」の場合、今までどおり送料・メーカー・受注期限・キャンセル可を表示し、場所と費用は表示しない', () => {
      stubFetchRoutes({});
      renderCreateDialog();

      expect(ALWAYS_SHOWN_LABELS.filter(hasField)).toEqual(ALWAYS_SHOWN_LABELS);
      expect(FIGURE_FIELD_LABELS.filter(hasField)).toEqual(FIGURE_FIELD_LABELS);
      expect(['場所', '手数料', '交通費（見込）', 'その他費用'].filter(hasField)).toEqual([]);
    });

    it('既定の項目の設定のカテゴリーを選んだ場合、送料・メーカー・受注期限・キャンセル可を表示し、場所と費用は表示しない', async () => {
      stubFetchRoutes({});
      renderCreateDialog();

      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), 'スケールフィギュア');

      expect(FIGURE_FIELD_LABELS.filter(hasField)).toEqual(FIGURE_FIELD_LABELS);
      expect(['場所', '手数料', '交通費（見込）', 'その他費用'].filter(hasField)).toEqual([]);
      expect(ALWAYS_SHOWN_LABELS.filter(hasField)).toEqual(ALWAYS_SHOWN_LABELS);
    });

    it('電子チケットのカテゴリーを選んだ場合、場所・手数料・交通費（見込）と、カテゴリーの名前（ドリンク代）のその他費用を表示し、送料・メーカー・受注期限・キャンセル可は表示しない', async () => {
      stubFetchRoutes({});
      renderCreateDialog();

      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), '電子チケット');

      expect(TICKET_FIELD_LABELS.filter(hasField)).toEqual(TICKET_FIELD_LABELS);
      expect(FIGURE_FIELD_LABELS.filter(hasField)).toEqual([]);
      expect(hasField('その他費用')).toBe(false);
      expect(ALWAYS_SHOWN_LABELS.filter(hasField)).toEqual(ALWAYS_SHOWN_LABELS);
    });

    it('その他費用の名前を変えていないカテゴリーでは、その他費用を「その他費用」と表示する', async () => {
      stubFetchRoutes({});
      renderCreateDialog();

      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), 'グッズ');

      expect(hasField('その他費用')).toBe(true);
    });

    it('カテゴリーを選び直した場合、表示する入力欄をすぐに変える', async () => {
      stubFetchRoutes({});
      renderCreateDialog();

      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), '電子チケット');
      expect(hasField('場所')).toBe(true);
      expect(hasField('送料（税込）')).toBe(false);

      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), 'スケールフィギュア');
      expect(hasField('場所')).toBe(false);
      expect(hasField('送料（税込）')).toBe(true);

      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), '電子チケット');
      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), '未設定');
      expect(hasField('場所')).toBe(false);
      expect(hasField('送料（税込）')).toBe(true);
    });

    it('場所と費用を入力して保存した場合、その値を送り、表示していない項目は未入力として送る', async () => {
      const { requests } = stubFetchRoutes({ 'POST /api/products': () => ({ status: 201, body: createProduct() }) });
      const onSaved = vi.fn();
      renderCreateDialog({ onSaved });

      await userEvent.type(screen.getByLabelText('商品名'), 'ライブ 東京公演');
      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), '電子チケット');
      await userEvent.type(screen.getByLabelText('金額（税込）'), '8800');
      await userEvent.type(screen.getByLabelText('場所'), '東京ドーム');
      await userEvent.type(screen.getByLabelText('手数料'), '330');
      await userEvent.type(screen.getByLabelText('交通費（見込）'), '2000');
      await userEvent.type(screen.getByLabelText('ドリンク代'), '600');
      await userEvent.click(screen.getByRole('button', { name: '保存' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(requests[0]?.body).toEqual({
        name: 'ライブ 東京公演',
        releaseMonth: '2026-11',
        status: 'considering',
        cancelable: false,
        price: 8800,
        shippingFee: null,
        orderDeadline: null,
        url: null,
        categoryId: 'ticket',
        maker: null,
        note: null,
        location: '東京ドーム',
        handlingFee: 330,
        travelExpense: 2000,
        otherExpense: 600,
        eventStartsAt: null,
        eventEndsAt: null,
      });
    });

    it('入力した後にカテゴリーを選び直して欄が消えた場合、その欄の値は保存しない', async () => {
      const { requests } = stubFetchRoutes({ 'POST /api/products': () => ({ status: 201, body: createProduct() }) });
      const onSaved = vi.fn();
      renderCreateDialog({ onSaved });

      await userEvent.type(screen.getByLabelText('商品名'), 'ライブ 東京公演');
      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), 'スケールフィギュア');
      await userEvent.type(screen.getByLabelText('送料（税込）'), '800');
      await userEvent.type(screen.getByLabelText('メーカー'), 'メーカーA');
      await userEvent.click(screen.getByLabelText('キャンセル可'));
      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), '電子チケット');
      await userEvent.type(screen.getByLabelText('場所'), '東京ドーム');
      await userEvent.click(screen.getByRole('button', { name: '保存' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(requests[0]?.body).toMatchObject({
        categoryId: 'ticket',
        shippingFee: null,
        maker: null,
        cancelable: false,
        location: '東京ドーム',
      });
    });

    it.each([
      ['場所', 'あ'.repeat(101), '場所は 100 文字以内で入力してください。'],
      ['手数料', '10000000', '金額は 9,999,999 円以下で入力してください。'],
      ['交通費（見込）', '-1', '金額は 0 円以上で入力してください。'],
      ['ドリンク代', '1.5', '金額は整数で入力してください。'],
    ])('%s の入力に誤りがある場合、文言を表示し、送信しない', async (label, value, message) => {
      const { requests } = stubFetchRoutes({});
      renderCreateDialog();

      await userEvent.type(screen.getByLabelText('商品名'), 'ライブ 東京公演');
      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), '電子チケット');
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      await userEvent.click(screen.getByRole('button', { name: '保存' }));

      expect(screen.getByText(message)).toBeInTheDocument();
      expect(requests).toEqual([]);
    });

    it('「保存して続けて追加」で保存した場合、場所・手数料・交通費（見込）・その他費用を空に戻し、カテゴリーは残す', async () => {
      stubFetchRoutes({ 'POST /api/products': () => ({ status: 201, body: createProduct() }) });
      const onSavedAndContinued = vi.fn();
      renderCreateDialog({ onSavedAndContinued });

      await userEvent.type(screen.getByLabelText('商品名'), 'ライブ 東京公演');
      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), '電子チケット');
      await userEvent.type(screen.getByLabelText('場所'), '東京ドーム');
      await userEvent.type(screen.getByLabelText('手数料'), '330');
      await userEvent.type(screen.getByLabelText('交通費（見込）'), '2000');
      await userEvent.type(screen.getByLabelText('ドリンク代'), '600');
      await userEvent.click(screen.getByRole('button', { name: '保存方法を選ぶ' }));
      await userEvent.click(screen.getByRole('menuitemradio', { name: '保存して続けて追加' }));
      await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));
      await waitFor(() => expect(onSavedAndContinued).toHaveBeenCalled());

      expect(screen.getByLabelText('カテゴリー')).toHaveDisplayValue('電子チケット');
      expect(screen.getByLabelText('場所')).toHaveValue('');
      expect(screen.getByLabelText('手数料')).toHaveValue(null);
      expect(screen.getByLabelText('交通費（見込）')).toHaveValue(null);
      expect(screen.getByLabelText('ドリンク代')).toHaveValue(null);
    });

    it('カテゴリーの定義を読めない場合（categories が null）、選べる項目をすべて表示し、その他費用は「その他費用」と表示する', () => {
      stubFetchRoutes({});
      renderCreateDialog({ categories: null });

      const labels = [...FIGURE_FIELD_LABELS, '場所', '手数料', '交通費（見込）', 'その他費用'];
      expect(labels.filter(hasField)).toEqual(labels);
    });
  });

  describe('編集', () => {
    it('保存されている場所と費用を入力欄に表示する', () => {
      stubFetchRoutes({});
      renderEditDialog(
        createPlainProduct({ categoryId: 'ticket', categoryName: '電子チケット', location: '東京ドーム', handlingFee: 330, travelExpense: 2000, otherExpense: 600 }),
      );

      expect(screen.getByLabelText('場所')).toHaveValue('東京ドーム');
      expect(screen.getByLabelText('手数料')).toHaveValue(330);
      expect(screen.getByLabelText('交通費（見込）')).toHaveValue(2000);
      expect(screen.getByLabelText('ドリンク代')).toHaveValue(600);
    });

    it('カテゴリーで無効な項目でも、値が保存されていれば表示して編集でき、保存されていない項目は表示しない', async () => {
      const { requests } = stubFetchRoutes({ 'PUT /api/products/product-1': () => ({ body: createProduct() }) });
      const onSaved = vi.fn();
      renderEditDialog(createPlainProduct({ categoryId: 'ticket', categoryName: '電子チケット', shippingFee: 800 }), { onSaved });

      expect(screen.getByLabelText('送料（税込）')).toHaveValue(800);
      expect(['メーカー', '受注期限', 'キャンセル可'].filter(hasField)).toEqual([]);
      await userEvent.clear(screen.getByLabelText('送料（税込）'));
      await userEvent.type(screen.getByLabelText('送料（税込）'), '500');
      await userEvent.click(screen.getByRole('button', { name: '保存' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(requests[0]?.body).toMatchObject({ categoryId: 'ticket', shippingFee: 500 });
    });

    it('保存されている値を変えずに保存した場合、カテゴリーで無効な項目の値もそのまま送る（保存済みの値は消さない）', async () => {
      const { requests } = stubFetchRoutes({ 'PUT /api/products/product-1': () => ({ body: createProduct() }) });
      const onSaved = vi.fn();
      renderEditDialog(
        createPlainProduct({ categoryId: 'scale', categoryName: 'スケールフィギュア', location: '東京ドーム', handlingFee: 330, maker: 'メーカーA', cancelable: true }),
        { onSaved },
      );

      await userEvent.click(screen.getByRole('button', { name: '保存' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(requests[0]?.body).toMatchObject({ location: '東京ドーム', handlingFee: 330, maker: 'メーカーA', cancelable: true });
    });

    it('保存されている値を空にしても、入力欄は消さず、未入力として送る', async () => {
      const { requests } = stubFetchRoutes({ 'PUT /api/products/product-1': () => ({ body: createProduct() }) });
      const onSaved = vi.fn();
      renderEditDialog(createPlainProduct({ categoryId: 'ticket', categoryName: '電子チケット', shippingFee: 800 }), { onSaved });

      await userEvent.clear(screen.getByLabelText('送料（税込）'));
      expect(hasField('送料（税込）')).toBe(true);
      await userEvent.click(screen.getByRole('button', { name: '保存' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(requests[0]?.body).toMatchObject({ shippingFee: null });
    });

    it('キャンセル可は、「可」が保存されている場合だけ、カテゴリーで無効でも表示する', () => {
      stubFetchRoutes({});
      const { unmount } = render(
        <ProductEditorDialog
          mode={{ kind: 'edit', product: createPlainProduct({ categoryId: 'ticket', categoryName: '電子チケット', cancelable: false }) }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          categories={categories}
        />,
      );
      expect(hasField('キャンセル可')).toBe(false);
      unmount();

      renderEditDialog(createPlainProduct({ categoryId: 'ticket', categoryName: '電子チケット', cancelable: true }));
      expect(screen.getByLabelText('キャンセル可')).toBeChecked();
    });

    it('カテゴリー未設定の商品は、送料・メーカー・受注期限・キャンセル可を常に表示し、場所と費用は値が保存されている項目だけを表示する', () => {
      stubFetchRoutes({});
      renderEditDialog(createPlainProduct({ otherExpense: 600 }));

      expect(FIGURE_FIELD_LABELS.filter(hasField)).toEqual(FIGURE_FIELD_LABELS);
      expect(screen.getByLabelText('その他費用')).toHaveValue(600);
      expect(['場所', '手数料', '交通費（見込）'].filter(hasField)).toEqual([]);
    });

    it('定義にないカテゴリーの商品は、カテゴリー未設定と同じく扱い、その他費用は「その他費用」と表示する', () => {
      stubFetchRoutes({});
      renderEditDialog(createPlainProduct({ categoryId: 'removed', categoryName: 'プライズ', location: '東京ドーム', otherExpense: 600 }));

      expect(FIGURE_FIELD_LABELS.filter(hasField)).toEqual(FIGURE_FIELD_LABELS);
      expect(screen.getByLabelText('場所')).toHaveValue('東京ドーム');
      expect(screen.getByLabelText('その他費用')).toHaveValue(600);
      expect(['手数料', '交通費（見込）'].filter(hasField)).toEqual([]);
    });

    it('カテゴリー未設定の商品で、送料・メーカー・受注期限・キャンセル可を新しく入力して保存できる', async () => {
      const { requests } = stubFetchRoutes({ 'PUT /api/products/product-1': () => ({ body: createProduct() }) });
      const onSaved = vi.fn();
      renderEditDialog(createPlainProduct(), { onSaved });

      await userEvent.type(screen.getByLabelText('送料（税込）'), '800');
      await userEvent.type(screen.getByLabelText('メーカー'), 'メーカーA');
      fireEvent.change(screen.getByLabelText('受注期限'), { target: { value: '2026-11-30' } });
      await userEvent.click(screen.getByLabelText('キャンセル可'));
      await userEvent.click(screen.getByRole('button', { name: '保存' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(requests[0]?.body).toMatchObject({ categoryId: null, shippingFee: 800, maker: 'メーカーA', orderDeadline: '2026-11-30', cancelable: true });
    });

    it('別のカテゴリーに選び直した場合、選んだカテゴリーで有効な項目と、値が保存されている項目を表示する', async () => {
      stubFetchRoutes({});
      renderEditDialog(createPlainProduct({ categoryId: 'scale', categoryName: 'スケールフィギュア', shippingFee: 800 }));

      await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), '電子チケット');

      expect(screen.getByLabelText('送料（税込）')).toHaveValue(800);
      expect(TICKET_FIELD_LABELS.filter(hasField)).toEqual(TICKET_FIELD_LABELS);
      expect(['メーカー', '受注期限', 'キャンセル可'].filter(hasField)).toEqual([]);
    });

    it('カテゴリーの定義を読めない場合（categories が null）、選べる項目をすべて表示する', () => {
      stubFetchRoutes({});
      renderEditDialog(createPlainProduct({ categoryId: 'ticket', categoryName: '電子チケット' }), { categories: null });

      const labels = [...FIGURE_FIELD_LABELS, '場所', '手数料', '交通費（見込）', 'その他費用'];
      expect(labels.filter(hasField)).toEqual(labels);
    });
  });
});

describe('開催日時と終了日時（PR #30 のレビュー）', () => {
  /** 開催日時と終了日時を使うカテゴリー。 */
  const liveCategory: CategoryResponse = { id: 'live', name: 'ライブ', fields: ['location', 'eventPeriod'], otherExpenseLabel: 'その他費用' };
  const categories = [figureCategory, liveCategory];

  /** その表記の入力欄があるか。 */
  function hasField(label: string): boolean {
    return screen.queryByLabelText(label) !== null;
  }

  /** 追加のモーダルを表示する。 */
  function renderCreateDialog(props: { onSaved?: () => void; onSavedAndContinued?: () => void; categories?: readonly CategoryResponse[] | null } = {}) {
    render(
      <ProductEditorDialog
        mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }}
        onClose={vi.fn()}
        onSaved={props.onSaved ?? vi.fn()}
        onSavedAndContinued={props.onSavedAndContinued}
        categories={props.categories === undefined ? categories : props.categories}
      />,
    );
  }

  /** 編集のモーダルを表示する。 */
  function renderEditDialog(product: ProductResponse, onSaved: () => void = vi.fn()) {
    render(<ProductEditorDialog mode={{ kind: 'edit', product }} onClose={vi.fn()} onSaved={onSaved} categories={categories} />);
  }

  it('開催日時と終了日時を使うカテゴリーを選んだ場合、日時（分まで）の入力欄を 2 つ表示する', async () => {
    stubFetchRoutes({});
    renderCreateDialog();
    expect(hasField('開催日時')).toBe(false);
    expect(hasField('終了日時')).toBe(false);

    await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), 'ライブ');

    expect(screen.getByLabelText('開催日時')).toHaveAttribute('type', 'datetime-local');
    expect(screen.getByLabelText('終了日時')).toHaveAttribute('type', 'datetime-local');
  });

  it('既定の項目の設定のカテゴリーと「未設定」では、開催日時と終了日時を表示しない', async () => {
    stubFetchRoutes({});
    renderCreateDialog();

    await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), 'スケールフィギュア');

    expect(hasField('開催日時')).toBe(false);
    expect(hasField('終了日時')).toBe(false);
  });

  it('日本時間で入力した開催日時と終了日時を、UTC の日時として送る', async () => {
    const { requests } = stubFetchRoutes({ 'POST /api/products': () => ({ status: 201, body: createProduct() }) });
    const onSaved = vi.fn();
    renderCreateDialog({ onSaved });

    await userEvent.type(screen.getByLabelText('商品名'), 'ライブ 東京公演');
    await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), 'ライブ');
    fireEvent.change(screen.getByLabelText('開催日時'), { target: { value: '2026-11-20T18:00' } });
    fireEvent.change(screen.getByLabelText('終了日時'), { target: { value: '2026-11-21T00:30' } });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[0]?.body).toMatchObject({ eventStartsAt: '2026-11-20T09:00:00.000Z', eventEndsAt: '2026-11-20T15:30:00.000Z' });
  });

  it('開催日時だけを入力した場合、終了日時は未入力として送る', async () => {
    const { requests } = stubFetchRoutes({ 'POST /api/products': () => ({ status: 201, body: createProduct() }) });
    const onSaved = vi.fn();
    renderCreateDialog({ onSaved });

    await userEvent.type(screen.getByLabelText('商品名'), 'ライブ 東京公演');
    await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), 'ライブ');
    fireEvent.change(screen.getByLabelText('開催日時'), { target: { value: '2026-11-20T18:00' } });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[0]?.body).toMatchObject({ eventStartsAt: '2026-11-20T09:00:00.000Z', eventEndsAt: null });
  });

  it('終了日時が開催日時より前の場合、終了日時の下に文言を表示し、送信しない', async () => {
    const { requests } = stubFetchRoutes({});
    renderCreateDialog();

    await userEvent.type(screen.getByLabelText('商品名'), 'ライブ 東京公演');
    await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), 'ライブ');
    fireEvent.change(screen.getByLabelText('開催日時'), { target: { value: '2026-11-20T18:00' } });
    fireEvent.change(screen.getByLabelText('終了日時'), { target: { value: '2026-11-20T17:59' } });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('終了日時は開催日時以降にしてください。')).toBeInTheDocument();
    expect(screen.getByLabelText('終了日時')).toHaveAttribute('aria-invalid', 'true');
    expect(requests).toEqual([]);
  });

  it('編集の場合、保存されている開催日時と終了日時を日本時間で表示する', () => {
    stubFetchRoutes({});
    renderEditDialog(
      createProduct({ categoryId: 'live', categoryName: 'ライブ', eventStartsAt: '2026-11-20T09:00:00.000Z', eventEndsAt: '2026-11-20T15:30:00.000Z' }),
    );

    expect(screen.getByLabelText('開催日時')).toHaveValue('2026-11-20T18:00');
    expect(screen.getByLabelText('終了日時')).toHaveValue('2026-11-21T00:30');
  });

  it('カテゴリー未設定の商品は、開催日時か終了日時のどちらかに値があれば両方の入力欄を表示し、変えずに保存するとそのまま送る', async () => {
    const { requests } = stubFetchRoutes({ 'PUT /api/products/product-1': () => ({ body: createProduct() }) });
    const onSaved = vi.fn();
    renderEditDialog(createProduct({ eventStartsAt: null, eventEndsAt: '2026-11-20T12:00:00.000Z' }), onSaved);

    expect(screen.getByLabelText('開催日時')).toHaveValue('');
    expect(screen.getByLabelText('終了日時')).toHaveValue('2026-11-20T21:00');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[0]?.body).toMatchObject({ eventStartsAt: null, eventEndsAt: '2026-11-20T12:00:00.000Z' });
  });

  it('カテゴリー未設定の商品で、開催日時と終了日時に値がない場合は表示しない', () => {
    stubFetchRoutes({});
    renderEditDialog(createProduct());

    expect(hasField('開催日時')).toBe(false);
    expect(hasField('終了日時')).toBe(false);
  });

  it('カテゴリーの定義を読めない場合（categories が null）、開催日時と終了日時を表示する', () => {
    stubFetchRoutes({});
    renderCreateDialog({ categories: null });

    expect(hasField('開催日時')).toBe(true);
    expect(hasField('終了日時')).toBe(true);
  });

  it('「保存して続けて追加」で保存した場合、開催日時と終了日時を空に戻す', async () => {
    stubFetchRoutes({ 'POST /api/products': () => ({ status: 201, body: createProduct() }) });
    const onSavedAndContinued = vi.fn();
    renderCreateDialog({ onSavedAndContinued });

    await userEvent.type(screen.getByLabelText('商品名'), 'ライブ 東京公演');
    await userEvent.selectOptions(screen.getByLabelText('カテゴリー'), 'ライブ');
    fireEvent.change(screen.getByLabelText('開催日時'), { target: { value: '2026-11-20T18:00' } });
    fireEvent.change(screen.getByLabelText('終了日時'), { target: { value: '2026-11-20T21:00' } });
    await userEvent.click(screen.getByRole('button', { name: '保存方法を選ぶ' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: '保存して続けて追加' }));
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));
    await waitFor(() => expect(onSavedAndContinued).toHaveBeenCalled());

    expect(screen.getByLabelText('開催日時')).toHaveValue('');
    expect(screen.getByLabelText('終了日時')).toHaveValue('');
  });
});

describe('商品の画像（issue #41）', () => {
  const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('画像の欄は、画像のファイルだけを選べる', () => {
    stubFetchRoutes({});
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByLabelText('画像')).toHaveAttribute('accept', 'image/*');
  });

  it('画像を選んだ場合、縮小した画像のプレビューを表示し、「画像を消す」ボタンを表示する', async () => {
    stubFetchRoutes({});
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText('画像'), photo);

    expect(await screen.findByRole('img', { name: '選んだ画像' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '画像を消す' })).toBeInTheDocument();
  });

  it('追加で画像を選んで保存した場合、商品を登録してから、縮小した画像を PUT /api/products/:productId/image に JSON で送り、onSaved を呼ぶ', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
      'PUT /api/products/product-1/image': () => ({ body: createProduct({ imageUrl: '/api/products/product-1/image?v=new' }) }),
    });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.upload(screen.getByLabelText('画像'), photo);
    await screen.findByRole('img', { name: '選んだ画像' });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(requests.map((recorded) => `${recorded.method} ${recorded.path}`)).toEqual(['POST /api/products', 'PUT /api/products/product-1/image']);
    expect(requests[1]?.contentType).toBe('application/json');
    expect(requests[1]?.body).toEqual({ data: 'PREPARED-photo.jpg' });
    expect(onSaved).not.toHaveBeenCalledWith({ imageSaveFailed: true });
  });

  it('画像を選ばずに保存した場合、画像は送らない', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
    });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(requests.map((recorded) => `${recorded.method} ${recorded.path}`)).toEqual(['POST /api/products']);
  });

  it('画像を選んでから「画像を消す」を押して保存した場合、画像は送らない', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
    });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.upload(screen.getByLabelText('画像'), photo);
    await screen.findByRole('img', { name: '選んだ画像' });
    await userEvent.click(screen.getByRole('button', { name: '画像を消す' }));
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(screen.queryByRole('img', { name: '選んだ画像' })).not.toBeInTheDocument();
    expect(requests.map((recorded) => `${recorded.method} ${recorded.path}`)).toEqual(['POST /api/products']);
  });

  it('画像を選んで保存せずに閉じた場合、何も送らない', async () => {
    const { requests } = stubFetchRoutes({});
    const onClose = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={onClose} onSaved={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText('画像'), photo);
    await screen.findByRole('img', { name: '選んだ画像' });
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(onClose).toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('画像として読めないファイルを選んだ場合、読めなかったことを表示し、プレビューを表示しない', async () => {
    stubFetchRoutes({});
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText('画像'), new File(['x'], 'broken.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByText('画像を読み込めませんでした。別の画像を選んでください。')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '選んだ画像' })).not.toBeInTheDocument();
  });

  it('編集で画像がある商品の場合、今の画像を表示する', () => {
    stubFetchRoutes({});
    render(
      <ProductEditorDialog
        mode={{ kind: 'edit', product: createProduct({ imageUrl: '/api/products/product-1/image?v=old' }) }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByRole('img', { name: '今の画像' })).toHaveAttribute('src', '/api/products/product-1/image?v=old');
    expect(screen.getByRole('button', { name: '画像を消す' })).toBeInTheDocument();
  });

  it('画面を /waders/ で開いている場合、今の画像は /waders の下の API から読む（issue #39）', () => {
    window.history.replaceState(null, '', '/waders/');
    stubFetchRoutes({});
    render(
      <ProductEditorDialog
        mode={{ kind: 'edit', product: createProduct({ imageUrl: '/api/products/product-1/image?v=old' }) }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByRole('img', { name: '今の画像' })).toHaveAttribute('src', '/waders/api/products/product-1/image?v=old');
  });

  it('編集で画像がない商品の場合、「画像を消す」ボタンを表示しない', () => {
    stubFetchRoutes({});
    render(<ProductEditorDialog mode={{ kind: 'edit', product: createProduct({ imageUrl: null }) }} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.queryByRole('img', { name: '今の画像' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '画像を消す' })).not.toBeInTheDocument();
  });

  it('編集で画像を差し替えて保存した場合、商品を更新してから、新しい画像を送る', async () => {
    const { requests } = stubFetchRoutes({
      'PUT /api/products/product-1': () => ({ body: createProduct({ imageUrl: '/api/products/product-1/image?v=old' }) }),
      'PUT /api/products/product-1/image': () => ({ body: createProduct({ imageUrl: '/api/products/product-1/image?v=new' }) }),
    });
    const onSaved = vi.fn();
    render(
      <ProductEditorDialog
        mode={{ kind: 'edit', product: createProduct({ imageUrl: '/api/products/product-1/image?v=old' }) }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await userEvent.upload(screen.getByLabelText('画像'), photo);
    await screen.findByRole('img', { name: '選んだ画像' });
    expect(screen.queryByRole('img', { name: '今の画像' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(requests.map((recorded) => `${recorded.method} ${recorded.path}`)).toEqual(['PUT /api/products/product-1', 'PUT /api/products/product-1/image']);
    expect(requests[1]?.body).toEqual({ data: 'PREPARED-photo.jpg' });
  });

  it('編集で「画像を消す」を押して保存した場合、商品を更新してから、DELETE /api/products/:productId/image を送る', async () => {
    const { requests } = stubFetchRoutes({
      'PUT /api/products/product-1': () => ({ body: createProduct({ imageUrl: '/api/products/product-1/image?v=old' }) }),
      'DELETE /api/products/product-1/image': () => ({ status: 204 }),
    });
    const onSaved = vi.fn();
    render(
      <ProductEditorDialog
        mode={{ kind: 'edit', product: createProduct({ imageUrl: '/api/products/product-1/image?v=old' }) }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '画像を消す' }));
    expect(screen.queryByRole('img', { name: '今の画像' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(requests.map((recorded) => `${recorded.method} ${recorded.path}`)).toEqual([
      'PUT /api/products/product-1',
      'DELETE /api/products/product-1/image',
    ]);
  });

  it('編集で画像に触れずに保存した場合、画像の API は呼ばない', async () => {
    const { requests } = stubFetchRoutes({
      'PUT /api/products/product-1': () => ({ body: createProduct({ imageUrl: '/api/products/product-1/image?v=old' }) }),
    });
    const onSaved = vi.fn();
    render(
      <ProductEditorDialog
        mode={{ kind: 'edit', product: createProduct({ imageUrl: '/api/products/product-1/image?v=old' }) }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(requests.map((recorded) => `${recorded.method} ${recorded.path}`)).toEqual(['PUT /api/products/product-1']);
  });

  it('商品を保存できて画像を保存できなかった場合、画像を保存できなかったことを onSaved に伝える', async () => {
    stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
      'PUT /api/products/product-1/image': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'error' } } }),
    });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.upload(screen.getByLabelText('画像'), photo);
    await screen.findByRole('img', { name: '選んだ画像' });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ imageSaveFailed: true }));
  });

  it('商品を保存できなかった場合、画像は送らない', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'error' } } }),
    });
    const onSaved = vi.fn();
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.upload(screen.getByLabelText('画像'), photo);
    await screen.findByRole('img', { name: '選んだ画像' });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('保存できませんでした。時間をおいて、もう一度お試しください。')).toBeInTheDocument();
    expect(requests.map((recorded) => `${recorded.method} ${recorded.path}`)).toEqual(['POST /api/products']);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('「保存して続けて追加」で保存した場合、画像を送ったうえで、画像の欄を空に戻す', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
      'PUT /api/products/product-1/image': () => ({ body: createProduct({ imageUrl: '/api/products/product-1/image?v=new' }) }),
    });
    const onSavedAndContinued = vi.fn();
    render(
      <ProductEditorDialog
        mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onSavedAndContinued={onSavedAndContinued}
      />,
    );

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.upload(screen.getByLabelText('画像'), photo);
    await screen.findByRole('img', { name: '選んだ画像' });
    await userEvent.click(screen.getByRole('button', { name: '保存方法を選ぶ' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: '保存して続けて追加' }));
    await userEvent.click(screen.getByRole('button', { name: '保存して続けて追加' }));
    await waitFor(() => expect(onSavedAndContinued).toHaveBeenCalled());

    expect(requests.map((recorded) => `${recorded.method} ${recorded.path}`)).toEqual(['POST /api/products', 'PUT /api/products/product-1/image']);
    expect(screen.queryByRole('img', { name: '選んだ画像' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '画像を消す' })).not.toBeInTheDocument();
    expect((screen.getByLabelText('画像') as HTMLInputElement).files).toHaveLength(0);
  });
});

describe('クリップボードの画像の貼り付け（issue #45）', () => {
  const pastedImage = new File(['pasted'], 'image.png', { type: 'image/png' });
  const selectedPhoto = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
  const NO_IMAGE_MESSAGE = 'クリップボードに画像がありません。';

  /** 貼り付けの中身（ブラウザの DataTransfer の、貼り付けで使う部分）を作る。 */
  function createClipboardData(contents: { readonly files?: readonly File[]; readonly text?: string }) {
    const files = contents.files ?? [];
    const text = contents.text ?? '';
    const fileItems = files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file }));
    const textItems = text === '' ? [] : [{ kind: 'string', type: 'text/plain', getAsFile: () => null }];
    return {
      files,
      items: [...textItems, ...fileItems],
      types: [...(text === '' ? [] : ['text/plain']), ...(files.length === 0 ? [] : ['Files'])],
      getData: (format: string) => (format === 'text/plain' || format === 'text' ? text : ''),
    };
  }

  /** 要素に貼り付ける。既定の動作（文字を入れるなど）が止められなければ true を返す。 */
  function pasteInto(element: Element, contents: { readonly files?: readonly File[]; readonly text?: string }): boolean {
    return fireEvent.paste(element, { clipboardData: createClipboardData(contents) });
  }

  /** 追加のモーダルを開く。 */
  function renderCreateDialog(onSaved = vi.fn()) {
    render(<ProductEditorDialog mode={{ kind: 'create', defaultReleaseMonth: '2026-11' }} onClose={vi.fn()} onSaved={onSaved} />);
  }

  it('画像の欄に、画像の貼り付け欄を表示する', () => {
    stubFetchRoutes({});
    renderCreateDialog();

    expect(screen.getByRole('textbox', { name: '画像の貼り付け欄' })).toBeInTheDocument();
  });

  it('貼り付け欄に画像を貼り付けた場合、縮小した画像のプレビューを表示し、「画像を消す」ボタンを表示する', async () => {
    stubFetchRoutes({});
    renderCreateDialog();

    const notPrevented = pasteInto(screen.getByRole('textbox', { name: '画像の貼り付け欄' }), { files: [pastedImage] });

    expect(await screen.findByRole('img', { name: '選んだ画像' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '画像を消す' })).toBeInTheDocument();
    expect(notPrevented).toBe(false);
  });

  it('モーダルの中の、入力欄ではない場所で画像を貼り付けた場合も、プレビューを表示する', async () => {
    stubFetchRoutes({});
    renderCreateDialog();

    pasteInto(screen.getByRole('dialog'), { files: [pastedImage] });

    expect(await screen.findByRole('img', { name: '選んだ画像' })).toBeInTheDocument();
  });

  it('商品名の欄に入力位置があるときに画像を貼り付けた場合、画像として受け取り、商品名には何も入れない', async () => {
    stubFetchRoutes({});
    renderCreateDialog();
    const nameInput = screen.getByLabelText('商品名');

    const notPrevented = pasteInto(nameInput, { files: [pastedImage] });

    expect(await screen.findByRole('img', { name: '選んだ画像' })).toBeInTheDocument();
    expect(notPrevented).toBe(false);
    expect(nameInput).toHaveValue('');
  });

  it('商品名の欄に文字を貼り付けた場合、今までどおり文字を貼る（既定の動作を止めず、画像も知らせも表示しない）', () => {
    stubFetchRoutes({});
    renderCreateDialog();

    const notPrevented = pasteInto(screen.getByLabelText('商品名'), { text: 'アクションフィギュア' });

    expect(notPrevented).toBe(true);
    expect(screen.queryByRole('img', { name: '選んだ画像' })).not.toBeInTheDocument();
    expect(screen.queryByText(NO_IMAGE_MESSAGE)).not.toBeInTheDocument();
  });

  it('貼り付け欄に文字だけを貼り付けた場合、クリップボードに画像がないことを表示し、文字は入れない', async () => {
    stubFetchRoutes({});
    renderCreateDialog();
    const pasteArea = screen.getByRole('textbox', { name: '画像の貼り付け欄' });

    const notPrevented = pasteInto(pasteArea, { text: 'アクションフィギュア' });

    expect(await screen.findByText(NO_IMAGE_MESSAGE)).toBeInTheDocument();
    expect(notPrevented).toBe(false);
    expect(pasteArea).toHaveTextContent('');
    expect(screen.queryByRole('img', { name: '選んだ画像' })).not.toBeInTheDocument();
  });

  it('貼り付け欄に画像でないファイルを貼り付けた場合、クリップボードに画像がないことを表示する', async () => {
    stubFetchRoutes({});
    renderCreateDialog();

    pasteInto(screen.getByRole('textbox', { name: '画像の貼り付け欄' }), { files: [new File(['%PDF'], 'document.pdf', { type: 'application/pdf' })] });

    expect(await screen.findByText(NO_IMAGE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '選んだ画像' })).not.toBeInTheDocument();
  });

  it('画像がないことを表示した後に画像を貼り付けた場合、表示を消してプレビューを表示する', async () => {
    stubFetchRoutes({});
    renderCreateDialog();
    const pasteArea = screen.getByRole('textbox', { name: '画像の貼り付け欄' });

    pasteInto(pasteArea, { text: 'アクションフィギュア' });
    await screen.findByText(NO_IMAGE_MESSAGE);
    pasteInto(pasteArea, { files: [pastedImage] });

    expect(await screen.findByRole('img', { name: '選んだ画像' })).toBeInTheDocument();
    expect(screen.queryByText(NO_IMAGE_MESSAGE)).not.toBeInTheDocument();
  });

  it('貼り付けた画像が画像として読めない場合、ファイルを選んだときと同じく読めなかったことを表示する', async () => {
    stubFetchRoutes({});
    renderCreateDialog();

    pasteInto(screen.getByRole('textbox', { name: '画像の貼り付け欄' }), { files: [new File(['x'], 'broken.jpg', { type: 'image/jpeg' })] });

    expect(await screen.findByText('画像を読み込めませんでした。別の画像を選んでください。')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '選んだ画像' })).not.toBeInTheDocument();
  });

  it('追加で画像を貼り付けて保存した場合、商品を登録してから、縮小した貼り付けた画像を送る', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
      'PUT /api/products/product-1/image': () => ({ body: createProduct({ imageUrl: '/api/products/product-1/image?v=new' }) }),
    });
    const onSaved = vi.fn();
    renderCreateDialog(onSaved);

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    pasteInto(screen.getByLabelText('商品名'), { files: [pastedImage] });
    await screen.findByRole('img', { name: '選んだ画像' });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(requests.map((recorded) => `${recorded.method} ${recorded.path}`)).toEqual(['POST /api/products', 'PUT /api/products/product-1/image']);
    expect(requests[1]?.body).toEqual({ data: 'PREPARED-image.png' });
    expect(screen.getByLabelText('商品名')).toHaveValue('アクションフィギュア');
  });

  it('ファイルを選んだ後に画像を貼り付けた場合、貼り付けた画像を送る', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products': () => ({ status: 201, body: createProduct() }),
      'PUT /api/products/product-1/image': () => ({ body: createProduct({ imageUrl: '/api/products/product-1/image?v=new' }) }),
    });
    const onSaved = vi.fn();
    renderCreateDialog(onSaved);

    await userEvent.type(screen.getByLabelText('商品名'), 'アクションフィギュア');
    await userEvent.upload(screen.getByLabelText('画像'), selectedPhoto);
    await screen.findByRole('img', { name: '選んだ画像' });
    pasteInto(screen.getByRole('textbox', { name: '画像の貼り付け欄' }), { files: [pastedImage] });
    await waitFor(() => expect((screen.getByLabelText('画像') as HTMLInputElement).files).toHaveLength(0));
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(requests[1]?.body).toEqual({ data: 'PREPARED-image.png' });
  });

  it('編集で画像がある商品に画像を貼り付けて保存した場合、今の画像の代わりにプレビューを表示し、商品を更新してから貼り付けた画像を送る', async () => {
    const { requests } = stubFetchRoutes({
      'PUT /api/products/product-1': () => ({ body: createProduct({ imageUrl: '/api/products/product-1/image?v=old' }) }),
      'PUT /api/products/product-1/image': () => ({ body: createProduct({ imageUrl: '/api/products/product-1/image?v=new' }) }),
    });
    const onSaved = vi.fn();
    render(
      <ProductEditorDialog
        mode={{ kind: 'edit', product: createProduct({ imageUrl: '/api/products/product-1/image?v=old' }) }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    pasteInto(screen.getByRole('textbox', { name: '画像の貼り付け欄' }), { files: [pastedImage] });
    await screen.findByRole('img', { name: '選んだ画像' });
    expect(screen.queryByRole('img', { name: '今の画像' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(requests.map((recorded) => `${recorded.method} ${recorded.path}`)).toEqual(['PUT /api/products/product-1', 'PUT /api/products/product-1/image']);
    expect(requests[1]?.body).toEqual({ data: 'PREPARED-image.png' });
  });
});
