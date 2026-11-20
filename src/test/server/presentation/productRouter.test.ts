import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { productSchema } from '../../../shared/productContract.ts';
import { TEST_CURRENT_TIME, createWebApplicationTestHarness, type WebApplicationTestHarness } from './webApplicationTestHarness.ts';

let harness: WebApplicationTestHarness;

beforeEach(() => {
  harness = createWebApplicationTestHarness('/nonexistent-client-build');
});

afterEach(() => {
  harness.database.close();
});

const validInput = { name: 'アクションフィギュア セカンド・フォーム', releaseMonth: '2026-12', price: 13200 };

/** 商品を API で登録し、応答の商品を返す。 */
async function createProductThroughApi(input: Record<string, unknown> = validInput) {
  const response = await request(harness.application).post('/api/products').send(input).expect(201);
  return productSchema.parse(response.body);
}

describe('GET /api/products', () => {
  it('商品がない場合、空の一覧を返す', async () => {
    const response = await request(harness.application).get('/api/products');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ products: [] });
  });

  it('登録した商品を登録順に返す', async () => {
    await createProductThroughApi({ ...validInput, name: '1件目' });
    harness.setCurrentTime(new Date('2026-11-17T04:00:00.000Z'));
    await createProductThroughApi({ ...validInput, name: '2件目' });

    const response = await request(harness.application).get('/api/products').expect(200);

    expect(response.body.products.map((product: { name: string }) => product.name)).toEqual(['1件目', '2件目']);
  });
});

describe('POST /api/products', () => {
  it('正しい入力の場合、201 と登録した商品を返す（省略した項目は既定値）', async () => {
    const product = await createProductThroughApi();

    expect(product).toEqual({
      id: 'product-1',
      name: 'アクションフィギュア セカンド・フォーム',
      releaseMonth: '2026-12',
      status: 'considering',
      cancelable: false,
      price: 13200,
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
      createdAt: TEST_CURRENT_TIME.toISOString(),
      updatedAt: TEST_CURRENT_TIME.toISOString(),
    });
  });

  it('入力に誤りがある場合、400 と項目ごとのエラーの文言を返し、登録しない', async () => {
    const response = await request(harness.application)
      .post('/api/products')
      .send({ name: '   ', releaseMonth: '2026-13', price: -1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(response.body.error.fieldErrors).sort()).toEqual(['name', 'price', 'releaseMonth']);
    expect(response.body.error.fieldErrors.name).toBe('商品名を入力してください。');
    expect(harness.productService.listProducts()).toEqual([]);
  });

  it('本文が JSON として読めない場合、400 を返す', async () => {
    const response = await request(harness.application)
      .post('/api/products')
      .set('Content-Type', 'application/json')
      .send('{ "name": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

  it('Content-Type が application/json でない場合、415 を返し、登録しない（他のサイトのフォームからの送信を防ぐ）', async () => {
    const response = await request(harness.application)
      .post('/api/products')
      .type('form')
      .send('name=test&releaseMonth=2026-12');

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(harness.productService.listProducts()).toEqual([]);
  });
});

describe('メーカーと備考（issue #18）', () => {
  it('メーカーと備考を付けて登録した場合、前後の空白を取り除いて保存し、一覧でも返す', async () => {
    const product = await createProductThroughApi({ ...validInput, maker: ' メーカーA ', note: '初回特典付き\n分割で届く' });

    expect(product).toMatchObject({ maker: 'メーカーA', note: '初回特典付き\n分割で届く' });
    const listResponse = await request(harness.application).get('/api/products').expect(200);
    expect(listResponse.body.products[0]).toMatchObject({ maker: 'メーカーA', note: '初回特典付き\n分割で届く' });
  });

  it('メーカーと備考を更新した場合、200 と更新した商品を返す', async () => {
    const created = await createProductThroughApi({ ...validInput, maker: 'メーカーA', note: '初回特典付き' });

    const response = await request(harness.application)
      .put(`/api/products/${created.id}`)
      .send({ ...validInput, maker: 'メーカーB', note: null })
      .expect(200);

    expect(response.body).toMatchObject({ maker: 'メーカーB', note: null });
  });

  it.each([
    ['maker', 'あ'.repeat(101), 'メーカーは 100 文字以内で入力してください。'],
    ['note', 'あ'.repeat(1001), '備考は 1,000 文字以内で入力してください。'],
  ])('%s が上限の文字数を超える場合、400 とその項目の文言を返し、登録しない', async (fieldName, value, message) => {
    const response = await request(harness.application)
      .post('/api/products')
      .send({ ...validInput, [fieldName]: value });

    expect(response.status).toBe(400);
    expect(response.body.error.fieldErrors).toEqual({ [fieldName]: message });
    expect(harness.productService.listProducts()).toEqual([]);
  });
});

describe('場所と費用（issue #26）', () => {
  const ticketInput = { ...validInput, location: ' 東京ドーム ', handlingFee: 330, travelExpense: 2000, otherExpense: 600 };

  it('場所と費用を付けて登録した場合、場所の前後の空白を取り除いて保存し、一覧でも返す', async () => {
    const product = await createProductThroughApi(ticketInput);

    const expected = { location: '東京ドーム', handlingFee: 330, travelExpense: 2000, otherExpense: 600 };
    expect(product).toMatchObject(expected);
    const listResponse = await request(harness.application).get('/api/products').expect(200);
    expect(listResponse.body.products[0]).toMatchObject(expected);
  });

  it('場所と費用を更新した場合、200 と更新した商品を返す（null で未入力に戻せる）', async () => {
    const created = await createProductThroughApi(ticketInput);

    const response = await request(harness.application)
      .put(`/api/products/${created.id}`)
      .send({ ...validInput, location: '日本武道館', handlingFee: null, travelExpense: 0, otherExpense: null })
      .expect(200);

    expect(response.body).toMatchObject({ location: '日本武道館', handlingFee: null, travelExpense: 0, otherExpense: null });
  });

  it.each([
    ['location', 'あ'.repeat(101), '場所は 100 文字以内で入力してください。'],
    ['handlingFee', -1, '金額は 0 円以上で入力してください。'],
    ['travelExpense', 10_000_000, '金額は 9,999,999 円以下で入力してください。'],
    ['otherExpense', 1.5, '金額は整数で入力してください。'],
  ])('%s が範囲外の場合、400 とその項目の文言を返し、登録しない', async (fieldName, value, message) => {
    const response = await request(harness.application)
      .post('/api/products')
      .send({ ...validInput, [fieldName]: value });

    expect(response.status).toBe(400);
    expect(response.body.error.fieldErrors).toEqual({ [fieldName]: message });
    expect(harness.productService.listProducts()).toEqual([]);
  });

  it('カテゴリーで有効でない項目やカテゴリー未設定の商品でも、API は値を受け付けて保存する（項目の出し入れは画面で行う。issue #27）', async () => {
    const product = await createProductThroughApi({ ...ticketInput, shippingFee: 800, maker: 'メーカーA', categoryId: null });

    expect(product).toMatchObject({ categoryId: null, shippingFee: 800, maker: 'メーカーA', location: '東京ドーム', handlingFee: 330 });
  });
});

describe('PUT /api/products/:productId', () => {
  it('正しい入力の場合、200 と更新した商品を返す', async () => {
    const created = await createProductThroughApi();
    harness.setCurrentTime(new Date('2026-11-18T00:00:00.000Z'));

    const response = await request(harness.application)
      .put(`/api/products/${created.id}`)
      .send({ ...validInput, status: 'reserved', cancelable: true });

    expect(response.status).toBe(200);
    expect(productSchema.parse(response.body)).toEqual({
      ...created,
      status: 'reserved',
      cancelable: true,
      updatedAt: '2026-11-18T00:00:00.000Z',
    });
  });

  it('存在しない商品の場合、404 を返す', async () => {
    const response = await request(harness.application).put('/api/products/missing').send(validInput);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('入力に誤りがある場合、400 を返し、更新しない', async () => {
    const created = await createProductThroughApi();

    const response = await request(harness.application).put(`/api/products/${created.id}`).send({ ...validInput, name: '' });

    expect(response.status).toBe(400);
    expect(harness.productService.listProducts()[0]?.name).toBe(validInput.name);
  });
});

describe('DELETE /api/products/:productId', () => {
  it('削除した場合、204 を返し、一覧から消える', async () => {
    const created = await createProductThroughApi();

    const response = await request(harness.application)
      .delete(`/api/products/${created.id}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(204);
    const listResponse = await request(harness.application).get('/api/products');
    expect(listResponse.body).toEqual({ products: [] });
  });

  it('存在しない商品の場合、404 を返す', async () => {
    const response = await request(harness.application).delete('/api/products/missing').set('Content-Type', 'application/json');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('Content-Type が application/json でない場合、415 を返し、削除しない', async () => {
    const created = await createProductThroughApi();

    const response = await request(harness.application).delete(`/api/products/${created.id}`);

    expect(response.status).toBe(415);
    expect(harness.productService.listProducts()).toHaveLength(1);
  });
});
