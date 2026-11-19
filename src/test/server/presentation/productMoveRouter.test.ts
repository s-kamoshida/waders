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
async function createProductThroughApi(releaseMonth: string) {
  const response = await request(harness.application)
    .post('/api/products')
    .send({ name: 'アクションフィギュア', releaseMonth, status: 'reserved' })
    .expect(201);
  return productSchema.parse(response.body);
}

/** 登録時を除いた変更履歴を返す。 */
function listChangesAfterRegistration(productId: string) {
  return harness.productRepository.listProductHistory(productId as ProductId).filter((entry) => entry.valueBefore !== null);
}

describe('PATCH /api/products/:productId/release-month（issue #13）', () => {
  it('当月以降の月を指定した場合、発売月だけを変え、200 と商品を返し、利用者の操作として履歴に記録する', async () => {
    const product = await createProductThroughApi('2026-12');

    const response = await request(harness.application).patch(`/api/products/${product.id}/release-month`).send({ releaseMonth: '2027-02' });

    expect(response.status).toBe(200);
    expect(productSchema.parse(response.body)).toMatchObject({ releaseMonth: '2027-02', status: 'reserved', name: 'アクションフィギュア' });
    expect(listChangesAfterRegistration(product.id)).toEqual([
      expect.objectContaining({ changeKind: 'user', field: 'releaseMonth', valueBefore: '2026-12', valueAfter: '2027-02' }),
    ]);
  });

  it('今と同じ月を指定した場合、200 を返し、何も変えず、履歴も記録しない', async () => {
    const product = await createProductThroughApi('2026-12');

    const response = await request(harness.application).patch(`/api/products/${product.id}/release-month`).send({ releaseMonth: '2026-12' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ releaseMonth: '2026-12', updatedAt: product.updatedAt });
    expect(listChangesAfterRegistration(product.id)).toEqual([]);
  });

  it('当月より前の月を指定した場合、400 と RELEASE_MONTH_IN_PAST を返し、変えない', async () => {
    const product = await createProductThroughApi('2026-12');

    const response = await request(harness.application).patch(`/api/products/${product.id}/release-month`).send({ releaseMonth: '2026-10' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('RELEASE_MONTH_IN_PAST');
    expect(harness.productRepository.findProductById(product.id as ProductId)?.releaseMonth).toBe('2026-12');
  });

  it('アーカイブされた商品の場合、400 と ARCHIVED_RELEASE_MONTH_CHANGE を返し、変えない', async () => {
    const product = await createProductThroughApi('2026-12');
    harness.setCurrentTime(japanTime('2027-01-05T12:00'));

    const response = await request(harness.application).patch(`/api/products/${product.id}/release-month`).send({ releaseMonth: '2027-02' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('ARCHIVED_RELEASE_MONTH_CHANGE');
    expect(harness.productRepository.findProductById(product.id as ProductId)?.releaseMonth).toBe('2026-12');
  });

  it('発売月の形式が誤っている場合、400 と VALIDATION_ERROR を返す', async () => {
    const product = await createProductThroughApi('2026-12');

    const response = await request(harness.application).patch(`/api/products/${product.id}/release-month`).send({ releaseMonth: '2027/02' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('存在しない商品の場合、404 を返す', async () => {
    const response = await request(harness.application).patch('/api/products/missing/release-month').send({ releaseMonth: '2027-02' });

    expect(response.status).toBe(404);
  });

  it('Content-Type が application/json でない場合、415 を返し、変えない', async () => {
    const product = await createProductThroughApi('2026-12');

    const response = await request(harness.application)
      .patch(`/api/products/${product.id}/release-month`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('releaseMonth=2027-02');

    expect(response.status).toBe(415);
    expect(harness.productRepository.findProductById(product.id as ProductId)?.releaseMonth).toBe('2026-12');
  });
});
