// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductEditorDialog } from '../../../client/components/ProductEditorDialog.tsx';
import type { ProductResponse } from '../../../shared/productContract.ts';
import { stubFetchRoutes } from '../testFetchStub.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    category: null,
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
          category: null,
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
      category: null,
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
      category: null,
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
