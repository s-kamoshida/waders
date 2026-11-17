import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { productListResponseSchema, productSchema } from '../../../shared/productContract.ts';
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

/** 予約済の商品を登録し、発売月を超過させる（一覧の取得で購入済・確認待ちになる）。 */
async function prepareArchivedReservedProduct() {
  const response = await request(harness.application)
    .post('/api/products')
    .send({ name: 'アクションフィギュア', releaseMonth: '2026-11', status: 'reserved' })
    .expect(201);
  harness.setCurrentTime(japanTime('2026-12-01T00:00'));
  await request(harness.application).get('/api/products').expect(200);
  return productSchema.parse(response.body);
}

describe('GET /api/products の自動遷移', () => {
  it('一覧を取得した場合、自動遷移を反映し、延期の確認待ちかどうかを含めて返す', async () => {
    const product = await prepareArchivedReservedProduct();

    const response = await request(harness.application).get('/api/products').expect(200);

    const listed = productListResponseSchema.parse(response.body).products.find((item) => item.id === product.id);
    expect(listed).toMatchObject({ status: 'purchased', deliveryConfirmationPending: true });
  });
});

describe('POST /api/products/:productId/restore', () => {
  it('当月以降の発売月を指定した場合、200 とリストに戻した商品を返す', async () => {
    const product = await prepareArchivedReservedProduct();

    const response = await request(harness.application).post(`/api/products/${product.id}/restore`).send({ releaseMonth: '2027-01' });

    expect(response.status).toBe(200);
    expect(productSchema.parse(response.body)).toMatchObject({ status: 'reserved', releaseMonth: '2027-01' });
  });

  it('発売月が当月より前の場合、400 を返す', async () => {
    const product = await prepareArchivedReservedProduct();

    const response = await request(harness.application).post(`/api/products/${product.id}/restore`).send({ releaseMonth: '2026-11' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('RELEASE_MONTH_IN_PAST');
  });

  it('発売月の形式が誤っている場合、400 を返す', async () => {
    const product = await prepareArchivedReservedProduct();

    const response = await request(harness.application).post(`/api/products/${product.id}/restore`).send({ releaseMonth: '2027/01' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('アーカイブされていない商品の場合、409 を返す', async () => {
    const created = await request(harness.application).post('/api/products').send({ name: '商品', releaseMonth: '2026-12' }).expect(201);

    const response = await request(harness.application).post(`/api/products/${created.body.id}/restore`).send({ releaseMonth: '2027-01' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRODUCT_NOT_ARCHIVED');
  });

  it('存在しない商品の場合、404 を返す', async () => {
    const response = await request(harness.application).post('/api/products/missing/restore').send({ releaseMonth: '2027-01' });

    expect(response.status).toBe(404);
  });
});

describe('POST /api/products/:productId/delivery-confirmation', () => {
  it.each([
    [{ answer: 'arrived' }, { status: 'purchased', releaseMonth: '2026-11' }],
    [{ answer: 'postponed', releaseMonth: '2027-02' }, { status: 'reserved', releaseMonth: '2027-02' }],
    [{ answer: 'notPurchased' }, { status: 'unpurchased', releaseMonth: '2026-11' }],
  ])('回答 %o の場合、200 と回答を反映した商品を返す', async (answer, expected) => {
    const product = await prepareArchivedReservedProduct();

    const response = await request(harness.application).post(`/api/products/${product.id}/delivery-confirmation`).send(answer);

    expect(response.status).toBe(200);
    expect(productSchema.parse(response.body)).toMatchObject(expected);
  });

  it('「延期された」で新しい発売月がない場合、400 を返す', async () => {
    const product = await prepareArchivedReservedProduct();

    const response = await request(harness.application)
      .post(`/api/products/${product.id}/delivery-confirmation`)
      .send({ answer: 'postponed' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('「延期された」で新しい発売月が当月より前の場合、400 を返す', async () => {
    const product = await prepareArchivedReservedProduct();

    const response = await request(harness.application)
      .post(`/api/products/${product.id}/delivery-confirmation`)
      .send({ answer: 'postponed', releaseMonth: '2026-10' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('RELEASE_MONTH_IN_PAST');
  });

  it('要件にない回答の場合、400 を返す', async () => {
    const product = await prepareArchivedReservedProduct();

    const response = await request(harness.application).post(`/api/products/${product.id}/delivery-confirmation`).send({ answer: 'lost' });

    expect(response.status).toBe(400);
  });

  it('確認待ちでない商品の場合、409 を返す', async () => {
    const product = await prepareArchivedReservedProduct();
    await request(harness.application).post(`/api/products/${product.id}/delivery-confirmation`).send({ answer: 'arrived' }).expect(200);

    const response = await request(harness.application).post(`/api/products/${product.id}/delivery-confirmation`).send({ answer: 'arrived' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DELIVERY_CONFIRMATION_NOT_PENDING');
  });

  it('存在しない商品の場合、404 を返す', async () => {
    const response = await request(harness.application).post('/api/products/missing/delivery-confirmation').send({ answer: 'arrived' });

    expect(response.status).toBe(404);
  });
});

describe('PUT /api/products/:productId（アーカイブされた商品）', () => {
  it('発売月を変えようとした場合、400 を返す', async () => {
    const product = await prepareArchivedReservedProduct();

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send({ name: 'アクションフィギュア', releaseMonth: '2027-01', status: 'purchased' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('ARCHIVED_RELEASE_MONTH_CHANGE');
  });
});
