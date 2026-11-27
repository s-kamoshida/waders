import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProductId } from '../../../server/domain/product.ts';
import { productSchema } from '../../../shared/productContract.ts';
import { createWebApplicationTestHarness, type WebApplicationTestHarness } from './webApplicationTestHarness.ts';

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

/** 商品を登録して返す。 */
async function createProductThroughApi(fields: { status: string; cancelable?: boolean; releaseMonth?: string }) {
  const response = await request(harness.application)
    .post('/api/products')
    .send({ name: 'アクションフィギュア', releaseMonth: fields.releaseMonth ?? '2026-12', price: 5000, status: fields.status, cancelable: fields.cancelable ?? false })
    .expect(201);
  return productSchema.parse(response.body);
}

/** 登録時を除いた変更履歴を返す。 */
function listChangesAfterRegistration(productId: string) {
  return harness.productRepository.listProductHistory(productId as ProductId).filter((entry) => entry.valueBefore !== null);
}

/** 保存されている商品を返す。 */
function findStoredProduct(productId: string) {
  return harness.productRepository.findProductById(productId as ProductId);
}

describe('PATCH /api/products/:productId/status（issue #52 の詳細画面からのステータスの変更）', () => {
  it('ステータスを指定した場合、ステータスだけを変え、200 と商品を返し、利用者の操作として履歴に記録する', async () => {
    const product = await createProductThroughApi({ status: 'considering' });
    harness.setCurrentTime(japanTime('2026-11-18T09:00'));

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'reserved' });

    expect(response.status).toBe(200);
    const updated = productSchema.parse(response.body);
    expect(updated).toMatchObject({ status: 'reserved', cancelable: false, name: 'アクションフィギュア', price: 5000, releaseMonth: '2026-12' });
    expect(updated.updatedAt).toBe(japanTime('2026-11-18T09:00').toISOString());
    expect(findStoredProduct(product.id)?.status).toBe('reserved');
    expect(listChangesAfterRegistration(product.id)).toEqual([
      expect.objectContaining({ changeKind: 'user', field: 'status', valueBefore: 'considering', valueAfter: 'reserved' }),
    ]);
  });

  it('cancelable を指定した場合、キャンセル可否も変える（予約済（キャンセル可）を選んだ場合）', async () => {
    const product = await createProductThroughApi({ status: 'considering' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'reserved', cancelable: true });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'reserved', cancelable: true });
    expect(findStoredProduct(product.id)).toMatchObject({ status: 'reserved', cancelable: true });
  });

  it('予約済（キャンセル可）から予約済にする場合、ステータスは同じでもキャンセル可否を変え、ステータスの履歴は記録しない', async () => {
    const product = await createProductThroughApi({ status: 'reserved', cancelable: true });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'reserved', cancelable: false });

    expect(response.status).toBe(200);
    expect(findStoredProduct(product.id)).toMatchObject({ status: 'reserved', cancelable: false });
    expect(listChangesAfterRegistration(product.id)).toEqual([]);
  });

  it('cancelable を省いた場合、キャンセル可否は今のまま変えない', async () => {
    const product = await createProductThroughApi({ status: 'reserved', cancelable: true });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'purchased' });

    expect(response.status).toBe(200);
    expect(findStoredProduct(product.id)).toMatchObject({ status: 'purchased', cancelable: true });
  });

  it('今と同じステータスとキャンセル可否を指定した場合、200 を返し、何も変えず、履歴も記録しない', async () => {
    const product = await createProductThroughApi({ status: 'reserved' });
    harness.setCurrentTime(japanTime('2026-11-18T09:00'));

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'reserved', cancelable: false });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'reserved', updatedAt: product.updatedAt });
    expect(listChangesAfterRegistration(product.id)).toEqual([]);
  });

  it('アーカイブされた商品の場合も、ステータスを変えられる', async () => {
    const product = await createProductThroughApi({ status: 'purchased', releaseMonth: '2026-11' });
    harness.setCurrentTime(japanTime('2026-12-05T12:00'));

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'unpurchased' });

    expect(response.status).toBe(200);
    expect(findStoredProduct(product.id)?.status).toBe('unpurchased');
  });

  it('応答には、一覧と同じく画像の URL と画像の種類を含める', async () => {
    const product = await createProductThroughApi({ status: 'considering' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'reserved' });

    expect(response.body).toMatchObject({ imageUrl: null, imageKind: null, discount: null });
  });

  it.each([
    ['ない', {}],
    ['決まった値でない', { status: 'shipped' }],
    ['文字列でない', { status: 1 }],
  ])('ステータスが%s場合、400 と VALIDATION_ERROR を返し、変えない', async (_label, body) => {
    const product = await createProductThroughApi({ status: 'considering' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(findStoredProduct(product.id)?.status).toBe('considering');
  });

  it('cancelable が真偽値でない場合、400 と VALIDATION_ERROR を返し、変えない', async () => {
    const product = await createProductThroughApi({ status: 'considering' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'reserved', cancelable: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(findStoredProduct(product.id)?.status).toBe('considering');
  });

  it('存在しない商品の場合、404 を返す', async () => {
    const response = await request(harness.application).patch('/api/products/missing/status').send({ status: 'reserved' });

    expect(response.status).toBe(404);
  });

  it('Content-Type が application/json でない場合、415 を返し、変えない', async () => {
    const product = await createProductThroughApi({ status: 'considering' });

    const response = await request(harness.application)
      .patch(`/api/products/${product.id}/status`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('status=reserved');

    expect(response.status).toBe(415);
    expect(findStoredProduct(product.id)?.status).toBe('considering');
  });
});

describe('ステータス「キャンセル」の API（issue #57）', () => {
  it('PATCH /api/products/:productId/status で canceled を指定した場合、キャンセルにし、200 と商品を返し、利用者の操作として履歴に記録する', async () => {
    const product = await createProductThroughApi({ status: 'reserved' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'canceled' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'canceled' });
    expect(findStoredProduct(product.id)?.status).toBe('canceled');
    expect(listChangesAfterRegistration(product.id)).toEqual([
      expect.objectContaining({ changeKind: 'user', field: 'status', valueBefore: 'reserved', valueAfter: 'canceled' }),
    ]);
  });

  it('PUT /api/products/:productId（編集）で canceled を指定した場合、キャンセルにして 200 を返す', async () => {
    const product = await createProductThroughApi({ status: 'considering' });

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send({ name: 'アクションフィギュア', releaseMonth: '2026-12', price: 5000, status: 'canceled' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'canceled' });
  });

  it('GET /api/products は、キャンセルの商品も返す（リストとアーカイブの振り分けは画面で行う）', async () => {
    const product = await createProductThroughApi({ status: 'reserved', releaseMonth: '2027-01' });
    await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'canceled' });

    const response = await request(harness.application).get('/api/products');

    expect(response.status).toBe(200);
    expect(response.body.products).toEqual([expect.objectContaining({ id: product.id, status: 'canceled', releaseMonth: '2027-01' })]);
  });

  it('PATCH /api/products/:productId/status で一覧にないステータス（cancelled）を指定した場合、400 と VALIDATION_ERROR を返し、変えない', async () => {
    const product = await createProductThroughApi({ status: 'reserved' });

    const response = await request(harness.application).patch(`/api/products/${product.id}/status`).send({ status: 'cancelled' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(findStoredProduct(product.id)?.status).toBe('reserved');
  });
});
