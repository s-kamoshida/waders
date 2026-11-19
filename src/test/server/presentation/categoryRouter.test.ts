import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { productListResponseSchema, productSchema } from '../../../shared/productContract.ts';
import { TEST_CATEGORIES, createWebApplicationTestHarness, type WebApplicationTestHarness } from './webApplicationTestHarness.ts';

let harness: WebApplicationTestHarness;

beforeEach(() => {
  harness = createWebApplicationTestHarness('/nonexistent-client-build');
});

afterEach(() => {
  harness.database.close();
});

const validInput = { name: 'アクションフィギュア', releaseMonth: '2026-12' };

/** 商品を登録して返す。 */
async function createProductThroughApi(input: Record<string, unknown>) {
  const response = await request(harness.application).post('/api/products').send(input).expect(201);
  return productSchema.parse(response.body);
}

/** 一覧から商品を探す。 */
async function findListedProduct(productId: string) {
  const response = await request(harness.application).get('/api/products').expect(200);
  return productListResponseSchema.parse(response.body).products.find((product) => product.id === productId);
}

describe('GET /api/categories', () => {
  it('定義のファイルの並び順で、カテゴリーの ID と名前を返す', async () => {
    const response = await request(harness.application).get('/api/categories');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ categories: TEST_CATEGORIES });
  });

  it('定義のファイルに誤りがある場合、503 と CATEGORY_DEFINITION_INVALID・ファイル名を含む理由を返す', async () => {
    harness.writeCategoryDefinition('{ "version": 1, "categories": [ }');

    const response = await request(harness.application).get('/api/categories');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('CATEGORY_DEFINITION_INVALID');
    expect(response.body.error.message).toMatch(/categories\.json/);
  });
});

describe('商品のカテゴリー（issue #10）', () => {
  it('定義にあるカテゴリーを指定して登録した場合、ID と、その時点の名前を保存して返す', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });

    expect(product).toMatchObject({ categoryId: 'action', categoryName: '可動フィギュア' });
  });

  it('カテゴリーを指定しない場合、カテゴリー未設定にする', async () => {
    const product = await createProductThroughApi(validInput);

    expect(product).toMatchObject({ categoryId: null, categoryName: null });
  });

  it('定義にないカテゴリーを指定して登録しようとした場合、400 と CATEGORY_NOT_FOUND を返し、登録しない', async () => {
    const response = await request(harness.application).post('/api/products').send({ ...validInput, categoryId: 'missing' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
    expect(response.body.error.fieldErrors).toEqual({ categoryId: 'カテゴリーが見つかりません。ページを読み込み直してください。' });
    expect(harness.productService.listProducts()).toEqual([]);
  });

  it('定義のファイルに誤りがある間にカテゴリーを指定して登録しようとした場合、503 を返し、登録しない', async () => {
    harness.writeCategoryDefinition('not json');

    const response = await request(harness.application).post('/api/products').send({ ...validInput, categoryId: 'scale' });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('CATEGORY_DEFINITION_INVALID');
    expect(harness.productService.listProducts()).toEqual([]);
  });

  it('定義のファイルに誤りがあっても、カテゴリーを指定しない登録と一覧はできる', async () => {
    harness.writeCategoryDefinition('not json');

    const product = await createProductThroughApi(validInput);

    expect(await findListedProduct(product.id)).toMatchObject({ categoryId: null });
  });

  it('定義を手で改名した場合（ID は同じ）、一覧では新しい名前を返す', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });

    harness.writeCategoryDefinition({ version: 1, categories: [{ id: 'action', name: 'アクションフィギュア' }] });

    expect(await findListedProduct(product.id)).toMatchObject({ categoryId: 'action', categoryName: 'アクションフィギュア' });
  });

  it('定義から手で消した場合、一覧では ID と、最後に保存した名前を返す', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });

    harness.writeCategoryDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }] });

    expect(await findListedProduct(product.id)).toMatchObject({ categoryId: 'action', categoryName: '可動フィギュア' });
  });

  it('定義のファイルに誤りがある場合も、一覧は最後に保存した名前で返す', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });

    harness.writeCategoryDefinition('not json');

    expect(await findListedProduct(product.id)).toMatchObject({ categoryId: 'action', categoryName: '可動フィギュア' });
  });

  it('定義から消えたカテゴリーのまま、ほかの項目を編集できる（カテゴリーは最後に保存した名前のまま）', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });
    harness.writeCategoryDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケールフィギュア' }] });

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send({ ...validInput, name: '名前を直した', categoryId: 'action' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: '名前を直した', categoryId: 'action', categoryName: '可動フィギュア' });
  });

  it('定義のファイルに誤りがある間も、カテゴリーを変えなければほかの項目を編集できる', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });
    harness.writeCategoryDefinition('not json');

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send({ ...validInput, name: '名前を直した', categoryId: 'action' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ categoryId: 'action', categoryName: '可動フィギュア' });
  });

  it('編集でカテゴリーを別のカテゴリーに変えた場合、新しい ID と名前を保存する', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send({ ...validInput, categoryId: 'scale' });

    expect(response.body).toMatchObject({ categoryId: 'scale', categoryName: 'スケールフィギュア' });
  });

  it('編集で定義にないカテゴリーに変えようとした場合、400 を返し、変更しない', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send({ ...validInput, categoryId: 'missing' });

    expect(response.status).toBe(400);
    expect(await findListedProduct(product.id)).toMatchObject({ categoryId: 'action' });
  });
});
