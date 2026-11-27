import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArchivedReleaseMonthChangeError,
  DeliveryConfirmationNotPendingError,
  ProductNotArchivedError,
  ProductNotFoundError,
  RestoreReleaseMonthInPastError,
  type ProductId,
} from '../../../server/domain/product.ts';
import { productInputSchema, statusChangeRequestSchema, type StatusChangeRequest } from '../../../shared/productContract.ts';
import { createWebApplicationTestHarness, type WebApplicationTestHarness } from '../presentation/webApplicationTestHarness.ts';

/** 日本時間の日時を UTC の Date にする。 */
function japanTime(localDateTime: string): Date {
  return new Date(`${localDateTime}:00+09:00`);
}

let harness: WebApplicationTestHarness;

beforeEach(() => {
  harness = createWebApplicationTestHarness('/nonexistent-client-build');
  harness.setCurrentTime(japanTime('2026-11-17T12:00'));
});

afterEach(() => {
  harness.database.close();
});

/** 商品を登録する。 */
function registerProduct(overrides: Record<string, unknown> = {}) {
  return harness.productService.createProduct(
    productInputSchema.parse({ name: 'アクションフィギュア', releaseMonth: '2026-11', ...overrides }),
  );
}

/** ステータスだけを変える本文を作る（キャンセル（issue #57）を実装の前でも型チェックを通すため、検証して作る）。 */
function productStatusChange(status: string): StatusChangeRequest {
  return statusChangeRequestSchema.parse({ status });
}

/** 商品の最新の状態を一覧から取得する（一覧の取得で自動遷移が反映される）。 */
function findListedProduct(productId: string) {
  return harness.productService.listProducts().find((product) => product.id === productId);
}

describe('一覧の取得時の自動遷移', () => {
  it('発売月を超過した予約済の商品を購入済にし、自動遷移として履歴に記録し、延期の確認待ちにする', () => {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));

    const listed = findListedProduct(product.id);

    expect(listed).toMatchObject({ status: 'purchased', deliveryConfirmationPending: true });
    expect(harness.productRepository.listProductHistory(product.id).at(-1)).toMatchObject({
      changedAt: japanTime('2026-12-01T00:00').toISOString(),
      changeKind: 'automatic',
      field: 'status',
      valueBefore: 'reserved',
      valueAfter: 'purchased',
    });
  });

  it('受注期限を超過した検討中の商品を未購入にし、延期の確認待ちにはしない', () => {
    const product = registerProduct({ status: 'considering', releaseMonth: '2027-01', orderDeadline: '2026-11-20' });
    harness.setCurrentTime(japanTime('2026-11-21T00:00'));

    expect(findListedProduct(product.id)).toMatchObject({ status: 'unpurchased', deliveryConfirmationPending: false });
  });

  it('遷移の対象がない場合、何度取得しても履歴を増やさない', () => {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));
    harness.productService.listProducts();
    const historyLength = harness.productRepository.listProductHistory(product.id).length;

    harness.productService.listProducts();

    expect(harness.productRepository.listProductHistory(product.id)).toHaveLength(historyLength);
  });

  it('手で購入済にした商品は、発売月を超過しても延期の確認待ちにしない', () => {
    const product = registerProduct({ status: 'purchased', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));

    expect(findListedProduct(product.id)).toMatchObject({ status: 'purchased', deliveryConfirmationPending: false });
  });

  it('サーバーの起動時などに、一覧を取得せずに自動遷移だけを行える', () => {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));

    harness.productService.applyAutomaticTransitions();

    expect(harness.productRepository.findProductById(product.id)?.status).toBe('purchased');
  });
});

describe('リストに戻す', () => {
  it('自動遷移の前のステータスに戻し、発売月を新しい月にし、延期の確認待ちを外す', () => {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));
    harness.productService.listProducts();

    const restored = harness.productService.restoreProduct(product.id, '2027-02');

    expect(restored).toMatchObject({ status: 'reserved', releaseMonth: '2027-02' });
    expect(findListedProduct(product.id)).toMatchObject({ status: 'reserved', deliveryConfirmationPending: false });
    expect(harness.productRepository.listProductHistory(product.id).slice(-2)).toEqual([
      expect.objectContaining({ changeKind: 'user', field: 'status', valueBefore: 'purchased', valueAfter: 'reserved' }),
      expect.objectContaining({ changeKind: 'user', field: 'releaseMonth', valueBefore: '2026-11', valueAfter: '2027-02' }),
    ]);
  });

  it('検討中から自動で未購入になった商品は、検討中に戻す', () => {
    const product = registerProduct({ status: 'considering', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));
    harness.productService.listProducts();

    expect(harness.productService.restoreProduct(product.id, '2026-12').status).toBe('considering');
  });

  it('手で購入済にしてアーカイブされた商品は、購入済のまま戻す', () => {
    const product = registerProduct({ status: 'purchased', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));

    expect(harness.productService.restoreProduct(product.id, '2026-12').status).toBe('purchased');
  });

  it('新しい発売月が当月より前の場合、RestoreReleaseMonthInPastError にする', () => {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));

    expect(() => harness.productService.restoreProduct(product.id, '2026-11')).toThrow(RestoreReleaseMonthInPastError);
  });

  it('アーカイブされていない商品の場合、ProductNotArchivedError にする', () => {
    const product = registerProduct({ releaseMonth: '2026-12' });

    expect(() => harness.productService.restoreProduct(product.id, '2027-01')).toThrow(ProductNotArchivedError);
  });

  it('存在しない商品の場合、ProductNotFoundError にする', () => {
    expect(() => harness.productService.restoreProduct('missing' as ProductId, '2027-01')).toThrow(ProductNotFoundError);
  });
});

describe('延期の確認への回答', () => {
  /** 予約済の商品を登録し、発売月を超過させて確認待ちにする。 */
  function prepareAwaitingProduct() {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));
    harness.productService.listProducts();
    return product;
  }

  it('「届いた」の場合、購入済のまま確認待ちを外す', () => {
    const product = prepareAwaitingProduct();

    harness.productService.answerDeliveryConfirmation(product.id, { answer: 'arrived' });

    expect(findListedProduct(product.id)).toMatchObject({ status: 'purchased', releaseMonth: '2026-11', deliveryConfirmationPending: false });
  });

  it('「延期された」の場合、新しい発売月で予約済に戻し、確認待ちを外す', () => {
    const product = prepareAwaitingProduct();

    harness.productService.answerDeliveryConfirmation(product.id, { answer: 'postponed', releaseMonth: '2027-01' });

    expect(findListedProduct(product.id)).toMatchObject({ status: 'reserved', releaseMonth: '2027-01', deliveryConfirmationPending: false });
  });

  it('「延期された」で新しい発売月が当月より前の場合、RestoreReleaseMonthInPastError にし、確認待ちのまま残す', () => {
    const product = prepareAwaitingProduct();

    expect(() =>
      harness.productService.answerDeliveryConfirmation(product.id, { answer: 'postponed', releaseMonth: '2026-11' }),
    ).toThrow(RestoreReleaseMonthInPastError);
    expect(findListedProduct(product.id)?.deliveryConfirmationPending).toBe(true);
  });

  it('「買わなかった」の場合、未購入にして利用者の操作として記録し、確認待ちを外す', () => {
    const product = prepareAwaitingProduct();

    harness.productService.answerDeliveryConfirmation(product.id, { answer: 'notPurchased' });

    expect(findListedProduct(product.id)).toMatchObject({ status: 'unpurchased', deliveryConfirmationPending: false });
    expect(harness.productRepository.listProductHistory(product.id).at(-1)).toMatchObject({
      changeKind: 'user',
      valueBefore: 'purchased',
      valueAfter: 'unpurchased',
    });
  });

  it('確認待ちでない商品に回答した場合、DeliveryConfirmationNotPendingError にする', () => {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-12' });

    expect(() => harness.productService.answerDeliveryConfirmation(product.id, { answer: 'arrived' })).toThrow(
      DeliveryConfirmationNotPendingError,
    );
  });
});

describe('アーカイブされた商品の編集', () => {
  /** 自動で購入済になり、アーカイブされた商品を用意する。 */
  function prepareArchivedProduct() {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-11', price: 10000 });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));
    harness.productService.listProducts();
    return product;
  }

  it('発売月以外の項目は編集できる', () => {
    const product = prepareArchivedProduct();

    const updated = harness.productService.updateProduct(
      product.id,
      productInputSchema.parse({ name: '名前を直した', releaseMonth: '2026-11', status: 'purchased', price: 12000 }),
    );

    expect(updated).toMatchObject({ name: '名前を直した', price: 12000, releaseMonth: '2026-11' });
  });

  it('発売月を変えようとした場合、ArchivedReleaseMonthChangeError にし、変更しない', () => {
    const product = prepareArchivedProduct();

    expect(() =>
      harness.productService.updateProduct(
        product.id,
        productInputSchema.parse({ name: 'アクションフィギュア', releaseMonth: '2027-01', status: 'purchased' }),
      ),
    ).toThrow(ArchivedReleaseMonthChangeError);
    expect(harness.productRepository.findProductById(product.id)?.releaseMonth).toBe('2026-11');
  });

  it('編集でステータスを変えた場合、延期の確認待ちを外す', () => {
    const product = prepareArchivedProduct();

    harness.productService.updateProduct(
      product.id,
      productInputSchema.parse({ name: 'アクションフィギュア', releaseMonth: '2026-11', status: 'unpurchased' }),
    );

    expect(findListedProduct(product.id)?.deliveryConfirmationPending).toBe(false);
  });
});

describe('ステータス「キャンセル」（issue #57、BR-38）', () => {
  /** 登録時を除いた、ステータスの変更履歴を返す。 */
  function listStatusChanges(productId: ProductId) {
    return harness.productRepository.listProductHistory(productId).filter((entry) => entry.field === 'status' && entry.valueBefore !== null);
  }

  it.each(['considering', 'reserved', 'purchased', 'unpurchased'])(
    '%s の商品を詳細画面のプルダウンでキャンセルにした場合、キャンセルにし、利用者の操作として履歴に記録する',
    (status) => {
      const product = registerProduct({ status, releaseMonth: '2026-12' });
      harness.setCurrentTime(japanTime('2026-11-18T09:00'));

      const changed = harness.productService.changeProductStatus(product.id, productStatusChange('canceled'));

      expect(changed.status).toBe('canceled');
      expect(harness.productRepository.findProductById(product.id)?.status).toBe('canceled');
      expect(listStatusChanges(product.id)).toEqual([
        { changedAt: japanTime('2026-11-18T09:00').toISOString(), changeKind: 'user', field: 'status', valueBefore: status, valueAfter: 'canceled' },
      ]);
    },
  );

  it('編集でキャンセルにした場合、キャンセルにし、利用者の操作として履歴に記録する', () => {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-12' });

    const updated = harness.productService.updateProduct(
      product.id,
      productInputSchema.parse({ name: 'アクションフィギュア', releaseMonth: '2026-12', status: 'canceled' }),
    );

    expect(updated.status).toBe('canceled');
    expect(listStatusChanges(product.id)).toEqual([expect.objectContaining({ changeKind: 'user', valueBefore: 'reserved', valueAfter: 'canceled' })]);
  });

  it('キャンセルの商品は、別のステータスへ手で戻せる', () => {
    const product = registerProduct({ status: 'canceled', releaseMonth: '2026-12' });

    expect(harness.productService.changeProductStatus(product.id, productStatusChange('reserved')).status).toBe('reserved');
  });

  it.each([
    ['検討中で受注期限と発売月を超過した', { status: 'considering', releaseMonth: '2026-11', orderDeadline: '2026-11-20' }],
    ['予約済で発売月を超過した', { status: 'reserved', releaseMonth: '2026-11' }],
  ])('キャンセルにした商品は、%s場合も、一覧を取得したときに自動では変えず、延期の確認待ちにもしない', (_label, fields) => {
    const product = registerProduct(fields);
    harness.productService.changeProductStatus(product.id, productStatusChange('canceled'));
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));

    expect(findListedProduct(product.id)).toMatchObject({ status: 'canceled', deliveryConfirmationPending: false });
    expect(harness.productRepository.listProductHistory(product.id).some((entry) => entry.changeKind === 'automatic')).toBe(false);
  });

  it('延期の確認を待っている商品をキャンセルにした場合（詳細画面のプルダウン）、延期の確認待ちを外す', () => {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));
    harness.productService.listProducts();

    harness.productService.changeProductStatus(product.id, productStatusChange('canceled'));

    expect(findListedProduct(product.id)).toMatchObject({ status: 'canceled', deliveryConfirmationPending: false });
  });

  it('発売月が当月以降のキャンセルの商品も、アーカイブされた商品として「リストに戻す」ができ、ステータスは検討中にする', () => {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2027-01' });
    harness.productService.changeProductStatus(product.id, productStatusChange('canceled'));
    harness.setCurrentTime(japanTime('2026-11-18T09:00'));

    const restored = harness.productService.restoreProduct(product.id, '2027-02');

    expect(restored).toMatchObject({ status: 'considering', releaseMonth: '2027-02' });
    expect(harness.productRepository.findProductById(product.id)).toMatchObject({ status: 'considering', releaseMonth: '2027-02' });
    expect(harness.productRepository.listProductHistory(product.id).slice(-2)).toEqual([
      expect.objectContaining({ changeKind: 'user', field: 'status', valueBefore: 'canceled', valueAfter: 'considering' }),
      expect.objectContaining({ changeKind: 'user', field: 'releaseMonth', valueBefore: '2027-01', valueAfter: '2027-02' }),
    ]);
  });

  it('発売月が当月以降のキャンセルの商品を、同じ発売月のままリストに戻す場合も、ステータスを検討中にする', () => {
    const product = registerProduct({ status: 'canceled', releaseMonth: '2026-12' });

    expect(harness.productService.restoreProduct(product.id, '2026-12')).toMatchObject({ status: 'considering', releaseMonth: '2026-12' });
  });

  it('自動で購入済になってからキャンセルにした商品をリストに戻す場合も、ステータスは検討中にする', () => {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));
    harness.productService.listProducts();
    harness.productService.changeProductStatus(product.id, productStatusChange('canceled'));

    expect(harness.productService.restoreProduct(product.id, '2026-12').status).toBe('considering');
  });

  it('キャンセルの商品をリストに戻す場合も、新しい発売月が当月より前なら RestoreReleaseMonthInPastError にし、変えない', () => {
    const product = registerProduct({ status: 'canceled', releaseMonth: '2026-12' });

    expect(() => harness.productService.restoreProduct(product.id, '2026-10')).toThrow(RestoreReleaseMonthInPastError);
    expect(harness.productRepository.findProductById(product.id)).toMatchObject({ status: 'canceled', releaseMonth: '2026-12' });
  });

  it('発売月が当月以降のキャンセルの商品も、アーカイブされた商品として、発売月は編集やドラッグアンドドロップでは変えられない（「リストに戻す」で変える）', () => {
    const product = registerProduct({ status: 'canceled', releaseMonth: '2026-12' });

    expect(() =>
      harness.productService.updateProduct(
        product.id,
        productInputSchema.parse({ name: 'アクションフィギュア', releaseMonth: '2027-01', status: 'canceled' }),
      ),
    ).toThrow(ArchivedReleaseMonthChangeError);
    expect(() => harness.productService.moveProductToReleaseMonth(product.id, '2027-01')).toThrow(ArchivedReleaseMonthChangeError);
    expect(harness.productRepository.findProductById(product.id)?.releaseMonth).toBe('2026-12');
  });

  it('延期の確認で「買わなかった」と答えた場合は、今までどおり未購入にする（キャンセルにはしない）', () => {
    const product = registerProduct({ status: 'reserved', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-01T00:00'));
    harness.productService.listProducts();

    expect(harness.productService.answerDeliveryConfirmation(product.id, { answer: 'notPurchased' }).status).toBe('unpurchased');
  });
});
