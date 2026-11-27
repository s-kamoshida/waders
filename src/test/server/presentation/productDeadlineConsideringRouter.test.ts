import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProductId } from '../../../server/domain/product.ts';
import { productListResponseSchema, productSchema } from '../../../shared/productContract.ts';
import { createWebApplicationTestHarness, type WebApplicationTestHarness } from './webApplicationTestHarness.ts';

/** 日本時間の日時を UTC の Date にする。 */
function japanTime(localDateTime: string): Date {
  return new Date(`${localDateTime}:00+09:00`);
}

let harness: WebApplicationTestHarness;

beforeEach(() => {
  harness = createWebApplicationTestHarness('/nonexistent-client-build');
  harness.setCurrentTime(japanTime('2026-11-27T21:00'));
});

afterEach(() => {
  harness.database.close();
});

/** 商品の登録・編集の本文（受注期限を過ぎた例の商品。発売月は先）。 */
function buildInput(fields: { status: string; orderDeadline: string | null; releaseMonth?: string }) {
  return {
    name: 'プラモデル T-60',
    releaseMonth: fields.releaseMonth ?? '2027-04',
    status: fields.status,
    price: 9800,
    orderDeadline: fields.orderDeadline,
  };
}

/** 商品を登録して返す。 */
async function createProductThroughApi(fields: { status: string; orderDeadline: string | null; releaseMonth?: string }) {
  const response = await request(harness.application).post('/api/products').send(buildInput(fields)).expect(201);
  return productSchema.parse(response.body);
}

/** 一覧を取得し（自動の切り替えを判定させ）、その商品を返す。 */
async function fetchListedProduct(productId: string) {
  const response = await request(harness.application).get('/api/products').expect(200);
  return productListResponseSchema.parse(response.body).products.find((product) => product.id === productId);
}

describe('受注期限を過ぎた商品を手で検討中にした場合（issue #60）', () => {
  it('詳細画面のステータスの変更（PATCH status）で検討中にした場合、受注期限を消し、一覧を取得しても検討中のまま残る', async () => {
    const product = await createProductThroughApi({ status: 'unpurchased', orderDeadline: '2026-08-26' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'considering' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'considering', orderDeadline: null });
    expect(await fetchListedProduct(product.id)).toMatchObject({ status: 'considering', orderDeadline: null });
  });

  it('編集（PUT）で検討中にした場合、受注期限を消し、一覧を取得しても検討中のまま残る', async () => {
    const product = await createProductThroughApi({ status: 'unpurchased', orderDeadline: '2026-08-26' });

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send(buildInput({ status: 'considering', orderDeadline: '2026-08-26' }));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'considering', orderDeadline: null });
    expect(await fetchListedProduct(product.id)).toMatchObject({ status: 'considering', orderDeadline: null });
  });

  it('検討中で登録した場合も、受注期限を過ぎていれば受注期限を消し、検討中のまま残る', async () => {
    const product = await createProductThroughApi({ status: 'considering', orderDeadline: '2026-08-26' });

    expect(product).toMatchObject({ status: 'considering', orderDeadline: null });
    expect(await fetchListedProduct(product.id)).toMatchObject({ status: 'considering', orderDeadline: null });
  });

  it('リストに戻した結果が検討中の場合も、受注期限を過ぎていれば受注期限を消し、検討中のまま残る', async () => {
    harness.setCurrentTime(japanTime('2026-11-17T12:00'));
    const product = await createProductThroughApi({ status: 'considering', orderDeadline: '2026-11-20', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-05T12:00'));
    expect(await fetchListedProduct(product.id)).toMatchObject({ status: 'unpurchased' });

    const response = await request(harness.application).post(`/api/products/${product.id}/restore`).send({ releaseMonth: '2027-01' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'considering', orderDeadline: null, releaseMonth: '2027-01' });
    expect(await fetchListedProduct(product.id)).toMatchObject({ status: 'considering', orderDeadline: null });
  });

  it('受注期限を消しても、変更履歴はステータスの変更だけを記録する（受注期限は記録しない）', async () => {
    const product = await createProductThroughApi({ status: 'unpurchased', orderDeadline: '2026-08-26' });

    await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'considering' }).expect(200);

    const changes = harness.productRepository.listProductHistory(product.id as ProductId).filter((entry) => entry.valueBefore !== null);
    expect(changes).toEqual([expect.objectContaining({ changeKind: 'user', field: 'status', valueBefore: 'unpurchased', valueAfter: 'considering' })]);
  });
});

describe('受注期限を消さない場合（issue #60）', () => {
  it('受注期限が今日の場合（まだ過ぎていない）、検討中にしても受注期限を残す', async () => {
    const product = await createProductThroughApi({ status: 'unpurchased', orderDeadline: '2026-11-27' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'considering' });

    expect(response.body).toMatchObject({ status: 'considering', orderDeadline: '2026-11-27' });
  });

  it('受注期限が昨日の場合（今日 0:00 に過ぎた）、検討中にすると受注期限を消す', async () => {
    const product = await createProductThroughApi({ status: 'unpurchased', orderDeadline: '2026-11-26' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'considering' });

    expect(response.body).toMatchObject({ status: 'considering', orderDeadline: null });
  });

  it('編集で検討中にすると同時に受注期限を今日以降に直した場合、その受注期限を残す', async () => {
    const product = await createProductThroughApi({ status: 'unpurchased', orderDeadline: '2026-08-26' });

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send(buildInput({ status: 'considering', orderDeadline: '2026-12-15' }));

    expect(response.body).toMatchObject({ status: 'considering', orderDeadline: '2026-12-15' });
    expect(await fetchListedProduct(product.id)).toMatchObject({ status: 'considering', orderDeadline: '2026-12-15' });
  });

  it.each(['reserved', 'purchased'])('受注期限を過ぎた商品を%sにした場合、受注期限を変えない', async (status) => {
    const product = await createProductThroughApi({ status: 'unpurchased', orderDeadline: '2026-08-26' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status });

    expect(response.body).toMatchObject({ status, orderDeadline: '2026-08-26' });
    expect(harness.productRepository.findProductById(product.id as ProductId)?.orderDeadline).toBe('2026-08-26');
  });

  it('受注期限を過ぎた未購入の商品を、ステータスを変えずに編集した場合、受注期限を変えない', async () => {
    const product = await createProductThroughApi({ status: 'unpurchased', orderDeadline: '2026-08-26' });

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send({ ...buildInput({ status: 'unpurchased', orderDeadline: '2026-08-26' }), name: '名前を直した' });

    expect(response.body).toMatchObject({ status: 'unpurchased', orderDeadline: '2026-08-26', name: '名前を直した' });
  });
});
