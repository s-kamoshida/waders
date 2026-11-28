import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProductId } from '../../../server/domain/product.ts';
import { productListResponseSchema, productSchema } from '../../../shared/productContract.ts';
import { createWebApplicationTestHarness, type WebApplicationTestHarness } from './webApplicationTestHarness.ts';

/** 日本時間の日時を UTC の Date にする。 */
function japanTime(localDateTime: string): Date {
  return new Date(`${localDateTime}:00+09:00`);
}

/** 変更履歴で、発売月の未定を表す値。 */
const UNDETERMINED_HISTORY_VALUE = 'undetermined';

let harness: WebApplicationTestHarness;

beforeEach(() => {
  harness = createWebApplicationTestHarness('/nonexistent-client-build');
  harness.setCurrentTime(japanTime('2026-11-17T12:00'));
});

afterEach(() => {
  harness.database.close();
});

/** 商品を登録して返す。 */
async function createProductThroughApi(fields: { releaseMonth: string | null; status?: string; orderDeadline?: string | null }) {
  const response = await request(harness.application)
    .post('/api/products')
    .send({ name: '発売時期未定のフィギュア', price: 18000, status: 'reserved', ...fields })
    .expect(201);
  return productSchema.parse(response.body);
}

/** 一覧を取得し（自動の切り替えを判定させ）、その商品を返す。 */
async function fetchListedProduct(productId: string) {
  const response = await request(harness.application).get('/api/products').expect(200);
  return productListResponseSchema.parse(response.body).products.find((product) => product.id === productId);
}

/** 登録時を除いた変更履歴を返す。 */
function listChangesAfterRegistration(productId: string) {
  return harness.productRepository.listProductHistory(productId as ProductId).filter((entry) => entry.valueBefore !== null);
}

describe('発売月が未定の商品の登録・編集（issue #62）', () => {
  it('発売月を null（未定）にして登録した場合、201 と発売月が null の商品を返す', async () => {
    const response = await request(harness.application)
      .post('/api/products')
      .send({ name: '発売時期未定のフィギュア', releaseMonth: null, status: 'reserved' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ releaseMonth: null, status: 'reserved' });
  });

  it('編集（PUT）で発売月を null にした場合、未定にし、未定を表す値で履歴に記録する', async () => {
    const product = await createProductThroughApi({ releaseMonth: '2027-03' });

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send({ name: product.name, releaseMonth: null, status: 'reserved', price: 18000 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ releaseMonth: null });
    expect(listChangesAfterRegistration(product.id)).toEqual([
      expect.objectContaining({ changeKind: 'user', field: 'releaseMonth', valueBefore: '2027-03', valueAfter: UNDETERMINED_HISTORY_VALUE }),
    ]);
  });

  it('編集（PUT）で未定の商品に発売月を入れた場合、その月にする', async () => {
    const product = await createProductThroughApi({ releaseMonth: null });

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send({ name: product.name, releaseMonth: '2027-05', status: 'reserved', price: 18000 });

    expect(response.body).toMatchObject({ releaseMonth: '2027-05' });
  });

  it.each(['2026/12', '未定', ''])('発売月が形式に合わない文字列（%s）の場合、今までどおり 400 を返す', async (releaseMonth) => {
    const response = await request(harness.application).post('/api/products').send({ name: '商品', releaseMonth, status: 'reserved' });

    expect(response.status).toBe(400);
  });

  it('発売月を省いた場合は、今までどおり 400 を返す（未定は null で明示する）', async () => {
    const response = await request(harness.application).post('/api/products').send({ name: '商品', status: 'reserved' });

    expect(response.status).toBe(400);
  });
});

describe('発売月が未定の商品の自動の切り替えとアーカイブ（issue #62）', () => {
  it('予約済の未定の商品は、何年たっても一覧の取得で購入済にならない（延期の確認待ちにもならない）', async () => {
    const product = await createProductThroughApi({ releaseMonth: null, status: 'reserved' });
    harness.setCurrentTime(japanTime('2030-06-01T12:00'));

    expect(await fetchListedProduct(product.id)).toMatchObject({ status: 'reserved', releaseMonth: null, deliveryConfirmationPending: false });
  });

  it('検討中の未定の商品は、受注期限を過ぎたら今までどおり未購入になる', async () => {
    const product = await createProductThroughApi({ releaseMonth: null, status: 'considering', orderDeadline: '2026-11-20' });
    harness.setCurrentTime(japanTime('2026-11-21T12:00'));

    expect(await fetchListedProduct(product.id)).toMatchObject({ status: 'unpurchased', releaseMonth: null });
  });

  it('未定の商品は、ステータスの変更やほかの操作でもエラーにならない（詳細画面からのステータスの変更）', async () => {
    const product = await createProductThroughApi({ releaseMonth: null, status: 'reserved' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'purchased' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'purchased', releaseMonth: null });
  });
});

describe('発売月だけを変える（ドラッグアンドドロップ）で未定にする・未定から月にする（issue #62）', () => {
  it('PATCH release-month で null を送った場合、未定にし、200 と商品を返す', async () => {
    const product = await createProductThroughApi({ releaseMonth: '2026-12' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/release-month`).send({ releaseMonth: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ releaseMonth: null });
    expect(listChangesAfterRegistration(product.id)).toEqual([
      expect.objectContaining({ field: 'releaseMonth', valueBefore: '2026-12', valueAfter: UNDETERMINED_HISTORY_VALUE }),
    ]);
  });

  it('未定の商品に PATCH release-month で当月以降の月を送った場合、その月にする', async () => {
    const product = await createProductThroughApi({ releaseMonth: null });

    const response = await request(harness.application).patch(`/api/products/${product.id}/release-month`).send({ releaseMonth: '2027-01' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ releaseMonth: '2027-01' });
  });

  it('未定の商品に PATCH release-month で当月より前の月を送った場合、今までどおり 400 を返し、変えない', async () => {
    const product = await createProductThroughApi({ releaseMonth: null });

    const response = await request(harness.application).patch(`/api/products/${product.id}/release-month`).send({ releaseMonth: '2026-10' });

    expect(response.status).toBe(400);
    expect(harness.productRepository.findProductById(product.id as ProductId)?.releaseMonth).toBeNull();
  });

  it('未定の商品に null を送った場合、何も変えず、履歴も記録しない', async () => {
    const product = await createProductThroughApi({ releaseMonth: null });

    const response = await request(harness.application).patch(`/api/products/${product.id}/release-month`).send({ releaseMonth: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ releaseMonth: null, updatedAt: product.updatedAt });
    expect(listChangesAfterRegistration(product.id)).toEqual([]);
  });
});

describe('リストに戻すで未定を選ぶ（issue #62）', () => {
  it('アーカイブされた商品を、新しい発売月を null（未定）にしてリストに戻した場合、未定の商品としてリストに戻す', async () => {
    const product = await createProductThroughApi({ releaseMonth: '2026-11', status: 'reserved' });
    harness.setCurrentTime(japanTime('2026-12-05T12:00'));
    expect(await fetchListedProduct(product.id)).toMatchObject({ status: 'purchased' });

    const response = await request(harness.application).post(`/api/products/${product.id}/restore`).send({ releaseMonth: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ releaseMonth: null, status: 'reserved' });
    harness.setCurrentTime(japanTime('2030-06-01T12:00'));
    expect(await fetchListedProduct(product.id)).toMatchObject({ status: 'reserved', releaseMonth: null });
  });
});
