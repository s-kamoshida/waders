// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestoreDialog } from '../../../client/components/RestoreDialog.tsx';
import type { ProductResponse } from '../../../shared/productContract.ts';
import { stubFetchRoutes } from '../testFetchStub.ts';

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
  category: null,
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
