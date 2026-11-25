import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { productListResponseSchema, productSchema } from '../../../shared/productContract.ts';
import { createWebApplicationTestHarness, type WebApplicationTestHarness } from './webApplicationTestHarness.ts';

let harness: WebApplicationTestHarness;

afterEach(() => {
  harness.database.close();
});

/** テスト用の Web アプリケーションを組み立てる。 */
function createHarness(options: { authenticationEnabled?: boolean } = {}): WebApplicationTestHarness {
  harness = createWebApplicationTestHarness('/nonexistent-client-build', options);
  return harness;
}

/** 先頭の印（形式）に、残りを決まった値で埋めて指定の大きさにした画像の中身を作る。 */
function createImageBytes(header: readonly number[], length = 256, filler = 7): Buffer {
  const bytes = Buffer.alloc(length, filler);
  Buffer.from(header).copy(bytes);
  return bytes;
}

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

/** 2MB（画像の大きさの上限）。 */
const MAXIMUM_IMAGE_BYTES = 2 * 1024 * 1024;

/** 商品を API で登録し、応答の商品を返す。 */
async function createProductThroughApi() {
  const response = await request(harness.application)
    .post('/api/products')
    .send({ name: 'アクションフィギュア', releaseMonth: '2026-12' })
    .expect(201);
  return productSchema.parse(response.body);
}

/** 画像を API で付ける。 */
function uploadImage(productId: string, bytes: Buffer) {
  return request(harness.application).put(`/api/products/${productId}/image`).send({ data: bytes.toString('base64') });
}

/** 画像を保存するフォルダのファイルの一覧（フォルダがなければ空）。 */
function listStoredImageFiles(): string[] {
  if (!existsSync(harness.productImageDirectory)) return [];
  return readdirSync(harness.productImageDirectory);
}

/** imageUrl の形（API のパスと、画像ごとに変わる版）。 */
const IMAGE_URL_PATTERN = /^\/api\/products\/product-1\/image\?v=[0-9a-f-]+$/;

describe('PUT /api/products/:productId/image（issue #41）', () => {
  it('JPEG の画像を送った場合、200 と imageUrl を含む商品を返し、一覧にも imageUrl が含まれる', async () => {
    createHarness();
    const product = await createProductThroughApi();
    expect(product.imageUrl).toBeNull();

    const response = await uploadImage(product.id, createImageBytes(JPEG_HEADER));

    expect(response.status).toBe(200);
    const updated = productSchema.parse(response.body);
    expect(updated.imageUrl).toMatch(IMAGE_URL_PATTERN);
    const listResponse = await request(harness.application).get('/api/products').expect(200);
    expect(productListResponseSchema.parse(listResponse.body).products[0]?.imageUrl).toBe(updated.imageUrl);
  });

  it('画像を付けても、商品の更新日時は変えない', async () => {
    createHarness();
    const product = await createProductThroughApi();

    const response = await uploadImage(product.id, createImageBytes(JPEG_HEADER)).expect(200);

    expect(productSchema.parse(response.body).updatedAt).toBe(product.updatedAt);
  });

  it.each([
    ['JPEG', 'image/jpeg', JPEG_HEADER],
    ['PNG', 'image/png', PNG_HEADER],
    ['WebP', 'image/webp', WEBP_HEADER],
  ])('%s の画像を送った場合、imageUrl から同じ中身を Content-Type %s で返す', async (_label, contentType, header) => {
    createHarness();
    const product = await createProductThroughApi();
    const bytes = createImageBytes(header);
    const updated = productSchema.parse((await uploadImage(product.id, bytes).expect(200)).body);

    const imageResponse = await request(harness.application).get(updated.imageUrl ?? '').buffer(true);

    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers['content-type']).toBe(contentType);
    expect(Buffer.compare(imageResponse.body as Buffer, bytes)).toBe(0);
  });

  it('保存したファイルは、利用者の入力から作らない名前で、所有者だけが読み書きできる（0600）', async () => {
    createHarness();
    const product = await createProductThroughApi();

    await uploadImage(product.id, createImageBytes(JPEG_HEADER)).expect(200);

    const files = listStoredImageFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(files[0]).not.toContain(product.id);
    expect(statSync(join(harness.productImageDirectory, files[0] ?? '')).mode & 0o777).toBe(0o600);
  });

  it('大きさがちょうど 2MB の画像は受け付ける', async () => {
    createHarness();
    const product = await createProductThroughApi();

    const response = await uploadImage(product.id, createImageBytes(JPEG_HEADER, MAXIMUM_IMAGE_BYTES));

    expect(response.status).toBe(200);
  });

  it('2MB を超える画像の場合、413 を返し、保存しない', async () => {
    createHarness();
    const product = await createProductThroughApi();

    const response = await uploadImage(product.id, createImageBytes(JPEG_HEADER, MAXIMUM_IMAGE_BYTES + 1));

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('IMAGE_TOO_LARGE');
    expect(listStoredImageFiles()).toEqual([]);
  });

  it.each([
    ['GIF', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ['テキスト', Array.from('<html><script>alert(1)</script></html>', (character) => character.charCodeAt(0))],
  ])('中身が受け付けない形式（%s）の場合、400 を返し、保存しない', async (_label, header) => {
    createHarness();
    const product = await createProductThroughApi();

    const response = await uploadImage(product.id, createImageBytes(header));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNSUPPORTED_IMAGE');
    expect(listStoredImageFiles()).toEqual([]);
    const listResponse = await request(harness.application).get('/api/products').expect(200);
    expect(productListResponseSchema.parse(listResponse.body).products[0]?.imageUrl).toBeNull();
  });

  it.each([
    ['data がない', {}],
    ['data が文字列でない', { data: 123 }],
    ['data が空', { data: '' }],
    ['data が base64 でない', { data: 'これは base64 ではない!!' }],
  ])('本文が誤っている（%s）場合、400 を返す', async (_label, body) => {
    createHarness();
    const product = await createProductThroughApi();

    const response = await request(harness.application).put(`/api/products/${product.id}/image`).send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('商品が存在しない場合、404 を返し、保存しない', async () => {
    createHarness();

    const response = await uploadImage('missing', createImageBytes(JPEG_HEADER));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect(listStoredImageFiles()).toEqual([]);
  });

  it('Content-Type が application/json でない場合、415 を返す（CSRF 対策）', async () => {
    createHarness();
    const product = await createProductThroughApi();

    const response = await request(harness.application)
      .put(`/api/products/${product.id}/image`)
      .set('Content-Type', 'image/jpeg')
      .send(createImageBytes(JPEG_HEADER));

    expect(response.status).toBe(415);
  });

  it('差し替えた場合、新しい画像を返し、imageUrl が変わり、前の画像のファイルを消す', async () => {
    createHarness();
    const product = await createProductThroughApi();
    const first = productSchema.parse((await uploadImage(product.id, createImageBytes(JPEG_HEADER, 256, 1)).expect(200)).body);
    const secondBytes = createImageBytes(PNG_HEADER, 256, 2);

    const second = productSchema.parse((await uploadImage(product.id, secondBytes).expect(200)).body);

    expect(second.imageUrl).not.toBe(first.imageUrl);
    expect(listStoredImageFiles()).toHaveLength(1);
    const imageResponse = await request(harness.application).get(second.imageUrl ?? '').buffer(true);
    expect(Buffer.compare(imageResponse.body as Buffer, secondBytes)).toBe(0);
  });

  it('商品を編集しても、画像は残る', async () => {
    createHarness();
    const product = await createProductThroughApi();
    const withImage = productSchema.parse((await uploadImage(product.id, createImageBytes(JPEG_HEADER)).expect(200)).body);

    const response = await request(harness.application)
      .put(`/api/products/${product.id}`)
      .send({ name: '名前を直した', releaseMonth: '2026-12' })
      .expect(200);

    expect(productSchema.parse(response.body).imageUrl).toBe(withImage.imageUrl);
  });
});

describe('DELETE /api/products/:productId/image（issue #41）', () => {
  it('画像を消した場合、204 を返し、imageUrl が null になり、ファイルを消す', async () => {
    createHarness();
    const product = await createProductThroughApi();
    await uploadImage(product.id, createImageBytes(JPEG_HEADER)).expect(200);

    const response = await request(harness.application).delete(`/api/products/${product.id}/image`).set('Content-Type', 'application/json');

    expect(response.status).toBe(204);
    const listResponse = await request(harness.application).get('/api/products').expect(200);
    expect(productListResponseSchema.parse(listResponse.body).products[0]?.imageUrl).toBeNull();
    expect(listStoredImageFiles()).toEqual([]);
  });

  it('画像がない商品の場合も、204 を返す', async () => {
    createHarness();
    const product = await createProductThroughApi();

    expect((await request(harness.application).delete(`/api/products/${product.id}/image`).set('Content-Type', 'application/json')).status).toBe(204);
  });

  it('商品が存在しない場合、404 を返す', async () => {
    createHarness();

    const response = await request(harness.application).delete('/api/products/missing/image').set('Content-Type', 'application/json');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });
});

describe('GET /api/products/:productId/image（issue #41）', () => {
  it('画像がない商品の場合、404 を返す', async () => {
    createHarness();
    const product = await createProductThroughApi();

    const response = await request(harness.application).get(`/api/products/${product.id}/image`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('IMAGE_NOT_FOUND');
  });

  it('画像の応答に、自サイト以外を禁止する CSP と、種類を推測させない指定を付ける', async () => {
    createHarness();
    const product = await createProductThroughApi();
    const updated = productSchema.parse((await uploadImage(product.id, createImageBytes(JPEG_HEADER)).expect(200)).body);

    const response = await request(harness.application).get(updated.imageUrl ?? '');

    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('認証が有効でログインしていない場合、画像を返さずに 401 を返す', async () => {
    createHarness({ authenticationEnabled: true });
    const setupResponse = await request(harness.application)
      .post('/api/auth/setup')
      .send({ loginId: 'owner', password: 'correct-horse-battery' })
      .expect(201);
    const setCookieHeaders = setupResponse.headers['set-cookie'] as string[] | undefined;
    const cookie = (setCookieHeaders?.[0] ?? '').split(';')[0] ?? '';
    const createResponse = await request(harness.application)
      .post('/api/products')
      .set('Cookie', cookie)
      .send({ name: 'アクションフィギュア', releaseMonth: '2026-12' })
      .expect(201);
    const product = productSchema.parse(createResponse.body);
    await request(harness.application)
      .put(`/api/products/${product.id}/image`)
      .set('Cookie', cookie)
      .send({ data: createImageBytes(JPEG_HEADER).toString('base64') })
      .expect(200);

    const response = await request(harness.application).get(`/api/products/${product.id}/image`);

    expect(response.status).toBe(401);
  });
});

describe('商品の削除と画像（issue #41）', () => {
  it('画像のある商品を削除した場合、画像のファイルも消す', async () => {
    createHarness();
    const product = await createProductThroughApi();
    await uploadImage(product.id, createImageBytes(JPEG_HEADER)).expect(200);

    await request(harness.application).delete(`/api/products/${product.id}`).set('Content-Type', 'application/json').expect(204);

    expect(listStoredImageFiles()).toEqual([]);
  });

  it('ほかの商品の画像は消さない', async () => {
    createHarness();
    const first = await createProductThroughApi();
    const second = await createProductThroughApi();
    await uploadImage(first.id, createImageBytes(JPEG_HEADER)).expect(200);
    await uploadImage(second.id, createImageBytes(PNG_HEADER)).expect(200);

    await request(harness.application).delete(`/api/products/${first.id}`).set('Content-Type', 'application/json').expect(204);

    expect(listStoredImageFiles()).toHaveLength(1);
    expect((await request(harness.application).get(`/api/products/${second.id}/image`)).status).toBe(200);
  });
});
