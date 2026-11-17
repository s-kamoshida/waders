// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryConfirmationDialog } from '../../../client/components/DeliveryConfirmationDialog.tsx';
import type { ProductListItem } from '../../../shared/productContract.ts';
import { stubFetchRoutes } from '../testFetchStub.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 確認待ちの商品を作る。 */
function createAwaitingProduct(id: string, name: string): ProductListItem {
  return {
    id,
    name,
    releaseMonth: '2026-10',
    status: 'purchased',
    cancelable: false,
    price: null,
    shippingFee: null,
    orderDeadline: null,
    url: null,
    category: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    deliveryConfirmationPending: true,
  };
}

const products = [createAwaitingProduct('product-1', '届いたはずの商品'), createAwaitingProduct('product-2', '延期されたかもしれない商品')];

/** 商品ごとの回答の選択肢を返す。 */
function getAnswerGroup(productName: string) {
  return screen.getByRole('radiogroup', { name: productName });
}

describe('DeliveryConfirmationDialog', () => {
  it('確認待ちの商品ごとに、「届いた」「延期された」「買わなかった」の選択肢を表示する', () => {
    stubFetchRoutes({});
    render(<DeliveryConfirmationDialog products={products} currentMonth="2026-11" onClose={vi.fn()} onCompleted={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: '発売月を過ぎた予約商品の確認' })).toBeInTheDocument();
    const radios = within(getAnswerGroup('届いたはずの商品')).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label') ?? radio.closest('label')?.textContent);
    expect(radios).toEqual(['届いた', '延期された', '買わなかった']);
    expect(getAnswerGroup('延期されたかもしれない商品')).toBeInTheDocument();
  });

  it('回答した商品だけを送り、送り終えたら onCompleted を呼ぶ（回答しなかった商品は送らない）', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products/product-1/delivery-confirmation': () => ({ body: products[0] }),
    });
    const onCompleted = vi.fn();
    render(<DeliveryConfirmationDialog products={products} currentMonth="2026-11" onClose={vi.fn()} onCompleted={onCompleted} />);

    await userEvent.click(within(getAnswerGroup('届いたはずの商品')).getByLabelText('届いた'));
    await userEvent.click(screen.getByRole('button', { name: '回答を保存' }));

    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/products/product-1/delivery-confirmation',
        body: { answer: 'arrived' },
        contentType: 'application/json',
      },
    ]);
  });

  it('「延期された」を選んだ場合、新しい発売月（既定は当月）を入力でき、その月を送る', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products/product-2/delivery-confirmation': () => ({ body: products[1] }),
    });
    const onCompleted = vi.fn();
    render(<DeliveryConfirmationDialog products={products} currentMonth="2026-11" onClose={vi.fn()} onCompleted={onCompleted} />);
    const group = getAnswerGroup('延期されたかもしれない商品');

    await userEvent.click(within(group).getByLabelText('延期された'));
    const monthInput = screen.getByLabelText('延期されたかもしれない商品の新しい発売月');
    expect(monthInput).toHaveValue('2026-11');
    fireEvent.change(monthInput, { target: { value: '2027-02' } });
    await userEvent.click(screen.getByRole('button', { name: '回答を保存' }));

    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(requests[0]?.body).toEqual({ answer: 'postponed', releaseMonth: '2027-02' });
  });

  it('「買わなかった」を選んだ場合、notPurchased を送る', async () => {
    const { requests } = stubFetchRoutes({
      'POST /api/products/product-1/delivery-confirmation': () => ({ body: products[0] }),
    });
    const onCompleted = vi.fn();
    render(<DeliveryConfirmationDialog products={products} currentMonth="2026-11" onClose={vi.fn()} onCompleted={onCompleted} />);

    await userEvent.click(within(getAnswerGroup('届いたはずの商品')).getByLabelText('買わなかった'));
    await userEvent.click(screen.getByRole('button', { name: '回答を保存' }));

    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(requests[0]?.body).toEqual({ answer: 'notPurchased' });
  });

  it('「延期された」の新しい発売月が当月より前の場合、文言を表示し、送信しない', async () => {
    const { requests } = stubFetchRoutes({});
    render(<DeliveryConfirmationDialog products={products} currentMonth="2026-11" onClose={vi.fn()} onCompleted={vi.fn()} />);

    await userEvent.click(within(getAnswerGroup('延期されたかもしれない商品')).getByLabelText('延期された'));
    fireEvent.change(screen.getByLabelText('延期されたかもしれない商品の新しい発売月'), { target: { value: '2026-10' } });
    await userEvent.click(screen.getByRole('button', { name: '回答を保存' }));

    expect(screen.getByText('発売月は当月（2026/11）以降を指定してください。')).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('送信に失敗した場合、失敗したことを表示し、onCompleted を呼ばない', async () => {
    stubFetchRoutes({
      'POST /api/products/product-1/delivery-confirmation': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } }),
    });
    const onCompleted = vi.fn();
    render(<DeliveryConfirmationDialog products={products} currentMonth="2026-11" onClose={vi.fn()} onCompleted={onCompleted} />);

    await userEvent.click(within(getAnswerGroup('届いたはずの商品')).getByLabelText('届いた'));
    await userEvent.click(screen.getByRole('button', { name: '回答を保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('回答を保存できませんでした。');
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('「あとで」を押した場合、送信せずに onClose を呼ぶ', async () => {
    const { requests } = stubFetchRoutes({});
    const onClose = vi.fn();
    render(<DeliveryConfirmationDialog products={products} currentMonth="2026-11" onClose={onClose} onCompleted={vi.fn()} />);

    await userEvent.click(within(getAnswerGroup('届いたはずの商品')).getByLabelText('届いた'));
    await userEvent.click(screen.getByRole('button', { name: 'あとで' }));

    expect(onClose).toHaveBeenCalled();
    expect(requests).toEqual([]);
  });
});
