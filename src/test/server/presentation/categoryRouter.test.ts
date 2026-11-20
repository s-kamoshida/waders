import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProductId } from '../../../server/domain/product.ts';
import { productListResponseSchema, productSchema } from '../../../shared/productContract.ts';
import {
  TEST_CATEGORIES,
  createWebApplicationTestHarness,
  withDefaultFieldSettings,
  type WebApplicationTestHarness,
} from './webApplicationTestHarness.ts';

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
  it('定義のファイルの並び順で、カテゴリーの ID と名前を返す（項目の指定がなければ既定の項目の設定を付ける。issue #27）', async () => {
    const response = await request(harness.application).get('/api/categories');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ categories: TEST_CATEGORIES.map(withDefaultFieldSettings) });
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

/** 定義のファイルの中身を JSON として読む。 */
function readCategoryDefinitionJson(): unknown {
  return JSON.parse(readFileSync(harness.categoryDefinitionFilePath, 'utf8'));
}

/** 一覧のすべての商品を返す。 */
async function listProductsThroughApi() {
  const response = await request(harness.application).get('/api/products').expect(200);
  return productListResponseSchema.parse(response.body).products;
}

describe('POST /api/categories（カテゴリーの追加。issue #10）', () => {
  it('名前の前後の空白を除いて定義の末尾に加え、201 と、ID を付けたカテゴリーを返す', async () => {
    const response = await request(harness.application).post('/api/categories').send({ name: ' プラモデル ' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(withDefaultFieldSettings({ id: 'category-1', name: 'プラモデル' }));
    expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: [...TEST_CATEGORIES, { id: 'category-1', name: 'プラモデル' }] });
  });

  it('追加の後、追加したカテゴリーを商品に設定できる', async () => {
    await request(harness.application).post('/api/categories').send({ name: 'プラモデル' }).expect(201);

    const product = await createProductThroughApi({ ...validInput, categoryId: 'category-1' });

    expect(product).toMatchObject({ categoryId: 'category-1', categoryName: 'プラモデル' });
  });

  it('アプリの起動後に手で編集した定義に対して追加し、手で編集した内容を消さない', async () => {
    harness.writeCategoryDefinition({ version: 1, categories: [{ id: 'scale', name: 'スケール' }, { name: '手で追加した' }] });

    await request(harness.application).post('/api/categories').send({ name: 'プラモデル' }).expect(201);

    expect(readCategoryDefinitionJson()).toEqual({
      version: 1,
      categories: [
        { id: 'scale', name: 'スケール' },
        { id: 'category-1', name: '手で追加した' },
        { id: 'category-2', name: 'プラモデル' },
      ],
    });
  });

  it.each([
    ['空白だけの', '  ', 'カテゴリー名を入力してください。'],
    ['50 文字を超える', 'あ'.repeat(51), 'カテゴリー名は 50 文字以内で入力してください。'],
  ])('名前が%s場合、400 と項目の文言を返し、定義を変えない', async (_label, name, message) => {
    const response = await request(harness.application).post('/api/categories').send({ name });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: { name: message } });
    expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: TEST_CATEGORIES });
  });

  it('定義のカテゴリーと同じ名前の場合、409 と CATEGORY_NAME_DUPLICATE を返し、定義を変えない', async () => {
    const response = await request(harness.application).post('/api/categories').send({ name: '可動フィギュア' });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: 'CATEGORY_NAME_DUPLICATE',
      fieldErrors: { name: 'カテゴリー「可動フィギュア」はすでにあります。' },
    });
    expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: TEST_CATEGORIES });
  });

  it('定義のファイルに誤りがある場合、503 と CATEGORY_DEFINITION_INVALID を返し、ファイルを書き換えない', async () => {
    harness.writeCategoryDefinition('not json');

    const response = await request(harness.application).post('/api/categories').send({ name: 'プラモデル' });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('CATEGORY_DEFINITION_INVALID');
    expect(readFileSync(harness.categoryDefinitionFilePath, 'utf8')).toBe('not json');
  });
});

describe('PUT /api/categories/:categoryId（カテゴリーの改名。issue #10）', () => {
  it('定義の名前を変え、200 と改名したカテゴリーを返し、そのカテゴリーの商品の名前も追従する', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });

    const response = await request(harness.application).put('/api/categories/action').send({ name: 'アクションフィギュア' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(withDefaultFieldSettings({ id: 'action', name: 'アクションフィギュア' }));
    expect(readCategoryDefinitionJson()).toEqual({
      version: 1,
      categories: [TEST_CATEGORIES[0], { id: 'action', name: 'アクションフィギュア' }],
    });
    expect(await findListedProduct(product.id)).toMatchObject({ categoryId: 'action', categoryName: 'アクションフィギュア' });
  });

  it('改名した後に定義のファイルが壊れても、商品は新しい名前で示す（商品に保存している名前も変える）', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });
    await request(harness.application).put('/api/categories/action').send({ name: 'アクションフィギュア' }).expect(200);

    harness.writeCategoryDefinition('not json');

    expect(await findListedProduct(product.id)).toMatchObject({ categoryId: 'action', categoryName: 'アクションフィギュア' });
  });

  it('ほかのカテゴリーの商品は変えない', async () => {
    const other = await createProductThroughApi({ ...validInput, categoryId: 'scale' });

    await request(harness.application).put('/api/categories/action').send({ name: 'アクションフィギュア' }).expect(200);

    expect(harness.productRepository.findProductById(other.id as ProductId)).toMatchObject({ categoryId: 'scale', categoryName: 'スケールフィギュア' });
  });

  it('ほかのカテゴリーと同じ名前の場合、409 と CATEGORY_NAME_DUPLICATE を返し、定義と商品を変えない', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });

    const response = await request(harness.application).put('/api/categories/action').send({ name: 'スケールフィギュア' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CATEGORY_NAME_DUPLICATE');
    expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: TEST_CATEGORIES });
    expect(await findListedProduct(product.id)).toMatchObject({ categoryName: '可動フィギュア' });
  });

  it('カテゴリーが最新の定義にない場合（手で消された場合など）、404 と CATEGORY_NOT_FOUND を返す', async () => {
    harness.writeCategoryDefinition({ version: 1, categories: [TEST_CATEGORIES[0]] });

    const response = await request(harness.application).put('/api/categories/action').send({ name: 'アクションフィギュア' });

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({
      code: 'CATEGORY_NOT_FOUND',
      message: 'カテゴリーが見つかりません。ページを読み込み直してください。',
    });
    expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: [TEST_CATEGORIES[0]] });
  });

  it('名前が空白だけの場合、400 を返し、定義を変えない', async () => {
    const response = await request(harness.application).put('/api/categories/action').send({ name: ' ' });

    expect(response.status).toBe(400);
    expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: TEST_CATEGORIES });
  });

  it('定義のファイルに誤りがある場合、503 を返し、商品を変えない', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });
    harness.writeCategoryDefinition('not json');

    const response = await request(harness.application).put('/api/categories/action').send({ name: 'アクションフィギュア' });

    expect(response.status).toBe(503);
    expect(await findListedProduct(product.id)).toMatchObject({ categoryName: '可動フィギュア' });
  });
});

describe('DELETE /api/categories/:categoryId（カテゴリーの削除。issue #10）', () => {
  it('商品が使っていないカテゴリーを削除した場合、204 を返し、定義から取り除く', async () => {
    const response = await request(harness.application).delete('/api/categories/action').send({ moveToCategoryId: null });

    expect(response.status).toBe(204);
    expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: [TEST_CATEGORIES[0]] });
  });

  it('移す先を指定した場合、そのカテゴリーの商品（アーカイブの商品を含む）を移す先の ID と名前にしてから削除する', async () => {
    const active = await createProductThroughApi({ ...validInput, categoryId: 'action' });
    const archived = await createProductThroughApi({ ...validInput, releaseMonth: '2026-11', status: 'purchased', categoryId: 'action' });
    const untouched = await createProductThroughApi(validInput);
    harness.setCurrentTime(new Date('2026-12-10T03:00:00.000Z'));

    await request(harness.application).delete('/api/categories/action').send({ moveToCategoryId: 'scale' }).expect(204);

    expect(await findListedProduct(active.id)).toMatchObject({ categoryId: 'scale', categoryName: 'スケールフィギュア' });
    expect(await findListedProduct(archived.id)).toMatchObject({ categoryId: 'scale', categoryName: 'スケールフィギュア' });
    expect(await findListedProduct(untouched.id)).toMatchObject({ categoryId: null });
    expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: [TEST_CATEGORIES[0]] });
  });

  it('移した商品は、更新日時を移した時刻にする', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });
    const movedAt = new Date('2026-11-18T03:00:00.000Z');
    harness.setCurrentTime(movedAt);

    await request(harness.application).delete('/api/categories/action').send({ moveToCategoryId: 'scale' }).expect(204);

    expect(await findListedProduct(product.id)).toMatchObject({ updatedAt: movedAt.toISOString() });
  });

  it('移す先が null の場合、そのカテゴリーの商品をカテゴリー未設定にしてから削除する', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });

    await request(harness.application).delete('/api/categories/action').send({ moveToCategoryId: null }).expect(204);

    expect(await findListedProduct(product.id)).toMatchObject({ categoryId: null, categoryName: null });
  });

  it.each([
    ['定義にないカテゴリーの', 'missing'],
    ['削除するカテゴリー自身の', 'action'],
  ])('移す先が%s場合、400 と CATEGORY_NOT_FOUND を返し、定義と商品を変えない', async (_label, moveToCategoryId) => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });

    const response = await request(harness.application).delete('/api/categories/action').send({ moveToCategoryId });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'CATEGORY_NOT_FOUND',
      fieldErrors: { moveToCategoryId: 'カテゴリーが見つかりません。ページを読み込み直してください。' },
    });
    expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: TEST_CATEGORIES });
    expect(await findListedProduct(product.id)).toMatchObject({ categoryId: 'action' });
  });

  it('移す先の指定（moveToCategoryId）がない場合、400 と VALIDATION_ERROR を返し、定義を変えない', async () => {
    const response = await request(harness.application).delete('/api/categories/action').send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: TEST_CATEGORIES });
  });

  it('カテゴリーが最新の定義にない場合、404 と CATEGORY_NOT_FOUND を返し、商品を変えない', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });
    harness.writeCategoryDefinition({ version: 1, categories: [TEST_CATEGORIES[0]] });

    const response = await request(harness.application).delete('/api/categories/action').send({ moveToCategoryId: null });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
    expect(await findListedProduct(product.id)).toMatchObject({ categoryId: 'action' });
  });

  it('定義のファイルに誤りがある場合、503 を返し、商品と壊れたファイルを変えない', async () => {
    const product = await createProductThroughApi({ ...validInput, categoryId: 'action' });
    harness.writeCategoryDefinition('not json');

    const response = await request(harness.application).delete('/api/categories/action').send({ moveToCategoryId: null });

    expect(response.status).toBe(503);
    expect(readFileSync(harness.categoryDefinitionFilePath, 'utf8')).toBe('not json');
    expect(await findListedProduct(product.id)).toMatchObject({ categoryId: 'action' });
  });
});

describe('定義にないカテゴリーの確認（issue #10）', () => {
  /** 「可動フィギュア」の商品を 2 件作ってから、定義から「可動フィギュア」を手で消す。 */
  async function createProductsOfRemovedCategory() {
    const first = await createProductThroughApi({ ...validInput, categoryId: 'action' });
    const second = await createProductThroughApi({ ...validInput, categoryId: 'action' });
    harness.writeCategoryDefinition({ version: 1, categories: [TEST_CATEGORIES[0]] });
    return [first, second];
  }

  describe('POST /api/categories/:categoryId/add-to-definition（定義にカテゴリーを追加する）', () => {
    it('同じ ID と、商品に最後に保存した名前で定義の末尾に加え、201 とカテゴリーを返す。商品は定義のカテゴリーとして扱う', async () => {
      const [product] = await createProductsOfRemovedCategory();

      const response = await request(harness.application).post('/api/categories/action/add-to-definition').send({});

      expect(response.status).toBe(201);
      expect(response.body).toEqual(withDefaultFieldSettings({ id: 'action', name: '可動フィギュア' }));
      expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: [TEST_CATEGORIES[0], { id: 'action', name: '可動フィギュア' }] });
      const categories = await request(harness.application).get('/api/categories').expect(200);
      expect(categories.body.categories).toContainEqual(withDefaultFieldSettings({ id: 'action', name: '可動フィギュア' }));
      expect(await findListedProduct(product?.id ?? '')).toMatchObject({ categoryId: 'action', categoryName: '可動フィギュア' });
    });

    it('定義に同じ名前のカテゴリーがある場合、409 と CATEGORY_NAME_DUPLICATE を返し、定義を変えない', async () => {
      await createProductsOfRemovedCategory();
      harness.writeCategoryDefinition({ version: 1, categories: [{ id: 'other', name: '可動フィギュア' }] });

      const response = await request(harness.application).post('/api/categories/action/add-to-definition').send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CATEGORY_NAME_DUPLICATE');
      expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: [{ id: 'other', name: '可動フィギュア' }] });
    });

    it('そのカテゴリーがすでに定義にある場合、409 と CATEGORY_ALREADY_DEFINED を返す', async () => {
      await createProductThroughApi({ ...validInput, categoryId: 'action' });

      const response = await request(harness.application).post('/api/categories/action/add-to-definition').send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CATEGORY_ALREADY_DEFINED');
      expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: TEST_CATEGORIES });
    });

    it('そのカテゴリーの商品がない場合、404 と CATEGORY_NOT_FOUND を返し、定義を変えない', async () => {
      const response = await request(harness.application).post('/api/categories/unknown/add-to-definition').send({});

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
      expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: TEST_CATEGORIES });
    });
  });

  describe('POST /api/categories/:categoryId/reassign-products（別のカテゴリーに移す・カテゴリー未設定にする）', () => {
    it('移す先を指定した場合、204 を返し、そのカテゴリーのすべての商品を移す先の ID と名前にする', async () => {
      const products = await createProductsOfRemovedCategory();
      const untouched = await createProductThroughApi(validInput);

      const response = await request(harness.application)
        .post('/api/categories/action/reassign-products')
        .send({ moveToCategoryId: 'scale' });

      expect(response.status).toBe(204);
      for (const product of products) {
        expect(await findListedProduct(product.id)).toMatchObject({ categoryId: 'scale', categoryName: 'スケールフィギュア' });
      }
      expect(await findListedProduct(untouched.id)).toMatchObject({ categoryId: null });
      expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: [TEST_CATEGORIES[0]] });
    });

    it('移す先が null の場合、そのカテゴリーのすべての商品をカテゴリー未設定にする', async () => {
      await createProductsOfRemovedCategory();

      await request(harness.application).post('/api/categories/action/reassign-products').send({ moveToCategoryId: null }).expect(204);

      expect((await listProductsThroughApi()).map((product) => product.categoryId)).toEqual([null, null]);
    });

    it('移す先が定義にない場合、400 と CATEGORY_NOT_FOUND を返し、商品を変えない', async () => {
      await createProductsOfRemovedCategory();

      const response = await request(harness.application)
        .post('/api/categories/action/reassign-products')
        .send({ moveToCategoryId: 'missing' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
      expect((await listProductsThroughApi()).map((product) => product.categoryId)).toEqual(['action', 'action']);
    });

    it('そのカテゴリーが定義にある場合、409 と CATEGORY_ALREADY_DEFINED を返し、商品を変えない（削除で移す）', async () => {
      await createProductThroughApi({ ...validInput, categoryId: 'action' });

      const response = await request(harness.application)
        .post('/api/categories/action/reassign-products')
        .send({ moveToCategoryId: null });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CATEGORY_ALREADY_DEFINED');
      expect((await listProductsThroughApi()).map((product) => product.categoryId)).toEqual(['action']);
    });

    it('そのカテゴリーの商品がない場合、404 と CATEGORY_NOT_FOUND を返す', async () => {
      const response = await request(harness.application)
        .post('/api/categories/unknown/reassign-products')
        .send({ moveToCategoryId: null });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('定義のファイルに誤りがある場合、503 を返し、商品を変えない', async () => {
      await createProductsOfRemovedCategory();
      harness.writeCategoryDefinition('not json');

      const response = await request(harness.application)
        .post('/api/categories/action/reassign-products')
        .send({ moveToCategoryId: null });

      expect(response.status).toBe(503);
      expect((await listProductsThroughApi()).map((product) => product.categoryId)).toEqual(['action', 'action']);
    });
  });
});

describe('カテゴリーの変更の要求の形式（CSRF 対策。issue #10）', () => {
  it.each([
    ['post', '/api/categories'],
    ['put', '/api/categories/action'],
    ['delete', '/api/categories/action'],
    ['post', '/api/categories/action/add-to-definition'],
    ['post', '/api/categories/action/reassign-products'],
    ['patch', '/api/categories/action/field-settings'],
  ] as const)('%s %s を Content-Type: application/json 以外で送った場合、415 を返し、定義を変えない', async (method, path) => {
    const agent = request(harness.application);
    const response = await agent[method](path).set('Content-Type', 'text/plain').send('name=x');

    expect(response.status).toBe(415);
    expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: TEST_CATEGORIES });
  });
});

describe('カテゴリーごとの入力項目（issue #27）', () => {
  const ticketCategory = {
    id: 'ticket',
    name: '電子チケット',
    fields: ['location', 'handlingFee', 'travelExpense', 'otherExpense'],
    otherExpenseLabel: 'ドリンク代',
  };

  describe('GET /api/categories', () => {
    it('定義のファイルの項目の指定と「その他費用」の名前を返す', async () => {
      harness.writeCategoryDefinition({ version: 1, categories: [TEST_CATEGORIES[0], ticketCategory] });

      const response = await request(harness.application).get('/api/categories').expect(200);

      expect(response.body).toEqual({ categories: [withDefaultFieldSettings(TEST_CATEGORIES[0]), ticketCategory] });
    });

    it('項目の指定が空の場合、選べる項目をすべて無効にし、「その他費用」の名前がなければ「その他費用」とする', async () => {
      harness.writeCategoryDefinition({ version: 1, categories: [{ id: 'simple', name: '簡易', fields: [] }] });

      const response = await request(harness.application).get('/api/categories').expect(200);

      expect(response.body).toEqual({ categories: [{ id: 'simple', name: '簡易', fields: [], otherExpenseLabel: 'その他費用' }] });
    });

    it('項目の指定に知らない項目の名前がある場合、503 と CATEGORY_DEFINITION_INVALID を返す', async () => {
      harness.writeCategoryDefinition({ version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: ['seat'] }] });

      const response = await request(harness.application).get('/api/categories');

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('CATEGORY_DEFINITION_INVALID');
    });
  });

  describe('PATCH /api/categories/:categoryId/field-settings', () => {
    it('項目を有効にした場合、200 と変更したカテゴリーを返し、定義のファイルに項目の指定を書く（ほかのカテゴリーは変えない）', async () => {
      const response = await request(harness.application)
        .patch('/api/categories/action/field-settings')
        .send({ fields: { location: true } });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: 'action',
        name: '可動フィギュア',
        fields: ['shippingFee', 'maker', 'orderDeadline', 'cancelable', 'location'],
        otherExpenseLabel: 'その他費用',
      });
      expect(readCategoryDefinitionJson()).toEqual({
        version: 1,
        categories: [
          TEST_CATEGORIES[0],
          { id: 'action', name: '可動フィギュア', fields: ['shippingFee', 'maker', 'orderDeadline', 'cancelable', 'location'] },
        ],
      });
    });

    it('開催日時と終了日時（eventPeriod）を有効にした場合、1 組の項目として場所の次の順に書く（PR #30 のレビュー）', async () => {
      harness.writeCategoryDefinition({ version: 1, categories: [{ id: 'ticket', name: '電子チケット', fields: ['location', 'handlingFee'] }] });

      const response = await request(harness.application)
        .patch('/api/categories/ticket/field-settings')
        .send({ fields: { eventPeriod: true } })
        .expect(200);

      expect(response.body.fields).toEqual(['location', 'eventPeriod', 'handlingFee']);
      expect(readCategoryDefinitionJson()).toEqual({
        version: 1,
        categories: [{ id: 'ticket', name: '電子チケット', fields: ['location', 'eventPeriod', 'handlingFee'] }],
      });
    });

    it('項目を無効にした場合、その項目だけを外す', async () => {
      const response = await request(harness.application)
        .patch('/api/categories/action/field-settings')
        .send({ fields: { shippingFee: false, cancelable: false } })
        .expect(200);

      expect(response.body.fields).toEqual(['maker', 'orderDeadline']);
    });

    it('「その他費用」の名前を、前後の空白を除いて保存し、null を送ると「その他費用」に戻す', async () => {
      const renamed = await request(harness.application)
        .patch('/api/categories/action/field-settings')
        .send({ otherExpenseLabel: ' ドリンク代 ' })
        .expect(200);

      expect(renamed.body.otherExpenseLabel).toBe('ドリンク代');
      expect(readCategoryDefinitionJson()).toMatchObject({ categories: [TEST_CATEGORIES[0], { id: 'action', otherExpenseLabel: 'ドリンク代' }] });

      const reset = await request(harness.application)
        .patch('/api/categories/action/field-settings')
        .send({ otherExpenseLabel: null })
        .expect(200);

      expect(reset.body.otherExpenseLabel).toBe('その他費用');
      expect(JSON.stringify(readCategoryDefinitionJson())).not.toContain('otherExpenseLabel');
    });

    it('保存する時点の最新の定義に対して変えた項目だけを反映し、手で編集した内容（ほかの項目の指定・ID のないカテゴリー・ほかの項目）を残す', async () => {
      harness.writeCategoryDefinition({
        version: 1,
        categories: [
          { id: 'ticket', name: '電子チケット', fields: ['location', 'handlingFee'], otherExpenseLabel: 'ドリンク代', memo: '手で書いたメモ' },
          { name: '手で追加した' },
        ],
      });

      await request(harness.application).patch('/api/categories/ticket/field-settings').send({ fields: { travelExpense: true } }).expect(200);

      expect(readCategoryDefinitionJson()).toEqual({
        version: 1,
        categories: [
          {
            id: 'ticket',
            name: '電子チケット',
            fields: ['location', 'handlingFee', 'travelExpense'],
            otherExpenseLabel: 'ドリンク代',
            memo: '手で書いたメモ',
          },
          { id: 'category-1', name: '手で追加した' },
        ],
      });
    });

    it.each([
      ['知らない項目の名前', { fields: { seat: true } }, 'fields'],
      ['真偽値でない項目の値', { fields: { location: 'yes' } }, 'fields'],
      ['20 文字を超える「その他費用」の名前', { otherExpenseLabel: 'あ'.repeat(21) }, 'otherExpenseLabel'],
      ['空白だけの「その他費用」の名前', { otherExpenseLabel: '   ' }, 'otherExpenseLabel'],
    ])('%sを送った場合、400 と VALIDATION_ERROR を返し、定義を変えない', async (_label, body, fieldName) => {
      const response = await request(harness.application).patch('/api/categories/action/field-settings').send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(response.body.error.fieldErrors)).toEqual([fieldName]);
      expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: TEST_CATEGORIES });
    });

    it('「その他費用」の名前が 20 文字を超える場合、文言を返す', async () => {
      const response = await request(harness.application)
        .patch('/api/categories/action/field-settings')
        .send({ otherExpenseLabel: 'あ'.repeat(21) });

      expect(response.body.error.fieldErrors).toEqual({ otherExpenseLabel: 'その他費用の名前は 20 文字以内で入力してください。' });
    });

    it('カテゴリーが最新の定義にない場合、404 と CATEGORY_NOT_FOUND を返し、定義を変えない', async () => {
      const response = await request(harness.application).patch('/api/categories/missing/field-settings').send({ fields: { location: true } });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
      expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: TEST_CATEGORIES });
    });

    it('定義のファイルに誤りがある場合、503 と CATEGORY_DEFINITION_INVALID を返し、ファイルを書き換えない', async () => {
      harness.writeCategoryDefinition('not json');

      const response = await request(harness.application).patch('/api/categories/action/field-settings').send({ fields: { location: true } });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('CATEGORY_DEFINITION_INVALID');
      expect(readFileSync(harness.categoryDefinitionFilePath, 'utf8')).toBe('not json');
    });

    it('項目を無効にしても、商品に保存されている値は消さない', async () => {
      const product = await createProductThroughApi({ ...validInput, categoryId: 'action', shippingFee: 800, maker: 'メーカーA' });

      await request(harness.application)
        .patch('/api/categories/action/field-settings')
        .send({ fields: { shippingFee: false, maker: false } })
        .expect(200);

      expect(await findListedProduct(product.id)).toMatchObject({ shippingFee: 800, maker: 'メーカーA' });
    });

    it('改名した場合、項目の指定と「その他費用」の名前は変えない', async () => {
      harness.writeCategoryDefinition({ version: 1, categories: [ticketCategory] });

      const response = await request(harness.application).put('/api/categories/ticket').send({ name: 'ライブ' }).expect(200);

      expect(response.body).toEqual({ ...ticketCategory, name: 'ライブ' });
      expect(readCategoryDefinitionJson()).toEqual({ version: 1, categories: [{ ...ticketCategory, name: 'ライブ' }] });
    });
  });
});
