// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestoreDialog } from '../../../client/components/RestoreDialog.tsx';
import type { ProductResponse } from '../../../shared/productContract.ts';
import { stubFetchRoutes } from '../testFetchStub.ts';
import { getHeaderCloseButton, holdFetchRoute } from '../dialogCloseButtonQueries.ts';

/** 画像なし（issue #51 の画像の種類）。項目ができる前でも型に合うよう、フィクスチャには展開して加える。 */
const NO_IMAGE_KIND = { imageKind: null } as const;

/** 値引きなし（issue #50）。既存の商品・テストの既定の値として、フィクスチャに展開して加える。 */
const NO_DISCOUNT = { discount: null } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

const product: ProductResponse = {
  id: 'product-1',
  name: '延期された商品',
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
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

describe('RestoreDialog', () => {
  it('商品名を表示し、新しい発売月の既定は当月にする', () => {
    stubFetchRoutes({});
    render(<RestoreDialog product={product} currentMonth="2026-11" onClose={vi.fn()} onRestored={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'リストに戻す' })).toHaveTextContent('延期された商品');
    expect(screen.getByLabelText('新しい発売月')).toHaveValue('2026-11');
  });

  it('「戻す」を押した場合、新しい発売月を POST /api/products/:id/restore に JSON で送り、onRestored を呼ぶ', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products/product-1/restore': () => ({ body: { ...product, status: 'reserved', releaseMonth: '2027-01' } }),
    });
    const onRestored = vi.fn();
    render(<RestoreDialog product={product} currentMonth="2026-11" onClose={vi.fn()} onRestored={onRestored} />);

    fireEvent.change(screen.getByLabelText('新しい発売月'), { target: { value: '2027-01' } });
    await userEvent.click(screen.getByRole('button', { name: '戻す' }));

    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(requests).toEqual([
      { method: 'POST', path: '/api/products/product-1/restore', body: { releaseMonth: '2027-01' }, contentType: 'application/json' },
    ]);
  });

  it('新しい発売月が当月より前の場合、文言を表示し、送信しない', async () => {
    const { requests } = stubFetchRoutes({});
    render(<RestoreDialog product={product} currentMonth="2026-11" onClose={vi.fn()} onRestored={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('新しい発売月'), { target: { value: '2026-10' } });
    await userEvent.click(screen.getByRole('button', { name: '戻す' }));

    expect(screen.getByText('発売月は当月（2026/11）以降を指定してください。')).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('戻せなかった場合、サーバーの文言を表示し、onRestored を呼ばない', async () => {
    stubFetchRoutes({
      'POST /api/products/product-1/restore': () => ({
        status: 409,
        body: { error: { code: 'PRODUCT_NOT_ARCHIVED', message: 'この商品はアーカイブされていません。' } },
      }),
    });
    const onRestored = vi.fn();
    render(<RestoreDialog product={product} currentMonth="2026-11" onClose={vi.fn()} onRestored={onRestored} />);

    await userEvent.click(screen.getByRole('button', { name: '戻す' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('この商品はアーカイブされていません。');
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('キャンセルした場合、送信せずに onClose を呼ぶ', async () => {
    const { requests } = stubFetchRoutes({});
    const onClose = vi.fn();
    render(<RestoreDialog product={product} currentMonth="2026-11" onClose={onClose} onRestored={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(onClose).toHaveBeenCalled();
    expect(requests).toEqual([]);
  });
});

describe('右上の閉じるボタン（issue #49）', () => {
  it('開いた場合、見出しの行に「閉じる」ボタン（×）を表示する', () => {
    stubFetchRoutes({});
    render(<RestoreDialog product={product} currentMonth="2026-11" onClose={vi.fn()} onRestored={vi.fn()} />);

    expect(getHeaderCloseButton(screen.getByRole('dialog', { name: 'リストに戻す' }))).toBeEnabled();
  });

  it('新しい発売月を変えてから「閉じる」ボタン（×）を押した場合、キャンセルと同じく送信せずに onClose を呼ぶ', async () => {
    const { requests } = stubFetchRoutes({});
    const onClose = vi.fn();
    const onRestored = vi.fn();
    render(<RestoreDialog product={product} currentMonth="2026-11" onClose={onClose} onRestored={onRestored} />);

    fireEvent.change(screen.getByLabelText('新しい発売月'), { target: { value: '2027-01' } });
    await userEvent.click(getHeaderCloseButton(screen.getByRole('dialog', { name: 'リストに戻す' })));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRestored).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('送信中の場合、「閉じる」ボタン（×）とキャンセルは押せず、×・キャンセル・Esc キーのいずれでも閉じない', async () => {
    const { fetchMock } = stubFetchRoutes({});
    holdFetchRoute(fetchMock, 'POST /api/products/product-1/restore');
    const onClose = vi.fn();
    render(<RestoreDialog product={product} currentMonth="2026-11" onClose={onClose} onRestored={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'リストに戻す' });

    await userEvent.click(screen.getByRole('button', { name: '戻す' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '戻す' })).toBeDisabled());
    const closeButton = getHeaderCloseButton(dialog);
    expect(closeButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled();
    await userEvent.click(closeButton);
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('Esc キーを押した場合、今までどおり送信せずに onClose を呼ぶ', async () => {
    const { requests } = stubFetchRoutes({});
    const onClose = vi.fn();
    render(<RestoreDialog product={product} currentMonth="2026-11" onClose={onClose} onRestored={vi.fn()} />);

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([]);
  });
});
