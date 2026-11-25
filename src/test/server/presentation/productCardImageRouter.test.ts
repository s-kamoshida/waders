import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { productListResponseSchema, productSchema } from '../../../shared/productContract.ts';
import { createWebApplicationTestHarness, type TestCardImageFetch, type WebApplicationTestHarness } from './webApplicationTestHarness.ts';

let harness: WebApplicationTestHarness;

afterEach(() => {
  harness.database.close();
});

const CARD_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);
const CARD_PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 8, 8]);
const UPLOADED_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 1, 1, 1]);

const SHOP_URL = 'https://shop.example.jp/item/1';
const OTHER_SHOP_URL = 'https://other.example.jp/item/2';

/** URL ごとに決まったカード画像を返す、偽の取得の処理。呼ばれた URL を記録する。 */
function createFakeFetch(imagesByUrl: Record<string, Uint8Array | null> = { [SHOP_URL]: CARD_JPEG }) {
  return vi.fn<TestCardImageFetch>(async (pageUrl) => {
    const bytes = imagesByUrl[pageUrl] ?? null;
    if (bytes === null) return null;
    return { bytes, format: bytes[0] === 0x89 ? 'png' : 'jpeg' };
  });
}

/** 終わらせるまで待たせる、偽の取得の処理。 */
function createDeferredFetch() {
  let finish: (bytes: Uint8Array | null) => void = () => {};
  const fetchCardImage = vi.fn<TestCardImageFetch>(
    () =>
      new Promise((resolve) => {
        finish = (bytes) => resolve(bytes === null ? null : { bytes, format: 'jpeg' });
      }),
  );
  return { fetchCardImage, finish: (bytes: Uint8Array | null) => finish(bytes) };
}

/** テスト用の Web アプリケーションを組み立てる。 */
function createHarness(fetchCardImage: TestCardImageFetch): WebApplicationTestHarness {
  harness = createWebApplicationTestHarness('/nonexistent-client-build', { fetchCardImage });
  return harness;
}

/** 商品を API で登録し、応答の商品を返す。 */
async function createProductThroughApi(url: string | null = SHOP_URL) {
  const response = await request(harness.application).post('/api/products').send({ name: 'アクションフィギュア', releaseMonth: '2026-12', url }).expect(201);
  return productSchema.parse(response.body);
}

/** 商品を API で更新する。 */
async function updateProductThroughApi(productId: string, url: string | null, name = 'アクションフィギュア') {
  const response = await request(harness.application).put(`/api/products/${productId}`).send({ name, releaseMonth: '2026-12', url }).expect(200);
  return productSchema.parse(response.body);
}

/** 一覧の最初の商品を返す。 */
async function findFirstListedProduct() {
  const response = await request(harness.application).get('/api/products').expect(200);
  return productListResponseSchema.parse(response.body).products[0];
}

/** 商品の画像（imageUrl の先）の中身を返す。なければ undefined。 */
async function readProductImage(productId: string): Promise<Buffer | undefined> {
  const response = await request(harness.application).get(`/api/products/${productId}/image`).buffer(true);
  return response.status === 200 ? (response.body as Buffer) : undefined;
}

/** 画像を保存するフォルダのファイルの一覧（フォルダがなければ空）。 */
function listStoredImageFiles(): string[] {
  if (!existsSync(harness.productImageDirectory)) return [];
  return readdirSync(harness.productImageDirectory);
}

describe('保存したときのカード画像の取得（issue #42）', () => {
  it('購入先の URL がある商品を登録した場合、その URL のカード画像を取りに行き、取れたら imageUrl から返す', async () => {
    const fetchCardImage = createFakeFetch();
    createHarness(fetchCardImage);

    const product = await createProductThroughApi();
    await harness.waitForCardImageFetches();

    expect(fetchCardImage).toHaveBeenCalledWith(SHOP_URL);
    const listed = await findFirstListedProduct();
    expect(listed?.imageUrl).toMatch(/^\/api\/products\/product-1\/image\?v=[0-9a-f-]+$/);
    expect(Buffer.compare((await readProductImage(product.id)) ?? Buffer.alloc(0), Buffer.from(CARD_JPEG))).toBe(0);
  });

  it('取りに行っている間も保存の応答はすぐに返し、一覧では取得中（cardImagePending）を示す。取り終えたら取得中を外す', async () => {
    const deferred = createDeferredFetch();
    createHarness(deferred.fetchCardImage);

    const product = await createProductThroughApi();

    expect(product.imageUrl).toBeNull();
    expect((await findFirstListedProduct())?.cardImagePending).toBe(true);
    deferred.finish(CARD_JPEG);
    await harness.waitForCardImageFetches();
    const listed = await findFirstListedProduct();
    expect(listed?.cardImagePending).toBe(false);
    expect(listed?.imageUrl).not.toBeNull();
  });

  it('購入先の URL がない商品の場合、取りに行かず、取得中にもしない', async () => {
    const fetchCardImage = createFakeFetch();
    createHarness(fetchCardImage);

    await createProductThroughApi(null);
    await harness.waitForCardImageFetches();

    expect(fetchCardImage).not.toHaveBeenCalled();
    expect((await findFirstListedProduct())?.cardImagePending).toBe(false);
  });

  it('取れなかった場合（null）、imageUrl は null のままで、商品は保存されている', async () => {
    createHarness(createFakeFetch({}));

    await createProductThroughApi();
    await harness.waitForCardImageFetches();

    const listed = await findFirstListedProduct();
    expect(listed?.name).toBe('アクションフィギュア');
    expect(listed?.imageUrl).toBeNull();
    expect(listed?.cardImagePending).toBe(false);
  });

  it('取りに行く処理が例外を投げた場合も、商品の保存は失敗させず、imageUrl は null のまま', async () => {
    createHarness(vi.fn<TestCardImageFetch>(async () => {
      throw new Error('接続できない');
    }));

    await createProductThroughApi();
    await harness.waitForCardImageFetches();

    const listed = await findFirstListedProduct();
    expect(listed?.imageUrl).toBeNull();
    expect(listed?.cardImagePending).toBe(false);
  });

  it('取ったカード画像のファイルは、所有者だけが読み書きできる（0600）', async () => {
    createHarness(createFakeFetch());

    await createProductThroughApi();
    await harness.waitForCardImageFetches();

    const files = listStoredImageFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(statSync(join(harness.productImageDirectory, files[0] ?? '')).mode & 0o777).toBe(0o600);
  });

  it('URL を変えずに編集して保存した場合、カード画像があれば取りに行かない', async () => {
    const fetchCardImage = createFakeFetch();
    createHarness(fetchCardImage);
    const product = await createProductThroughApi();
    await harness.waitForCardImageFetches();

    await updateProductThroughApi(product.id, SHOP_URL, '名前を直した');
    await harness.waitForCardImageFetches();

    expect(fetchCardImage).toHaveBeenCalledTimes(1);
  });

  it('URL を変えずに編集して保存した場合、カード画像がなければ（前に取れなかった・登録済みの商品）もう一度取りに行く', async () => {
    let available = false;
    const fetchCardImage = vi.fn<TestCardImageFetch>(async () => (available ? { bytes: CARD_JPEG, format: 'jpeg' } : null));
    createHarness(fetchCardImage);
    const product = await createProductThroughApi();
    await harness.waitForCardImageFetches();
    available = true;

    await updateProductThroughApi(product.id, SHOP_URL, '名前を直した');
    await harness.waitForCardImageFetches();

    expect(fetchCardImage).toHaveBeenCalledTimes(2);
    expect((await findFirstListedProduct())?.imageUrl).not.toBeNull();
  });

  it('URL を変えた場合、前のカード画像を消して、新しい URL のカード画像を取りに行く', async () => {
    const fetchCardImage = createFakeFetch({ [SHOP_URL]: CARD_JPEG, [OTHER_SHOP_URL]: CARD_PNG });
    createHarness(fetchCardImage);
    const product = await createProductThroughApi();
    await harness.waitForCardImageFetches();

    await updateProductThroughApi(product.id, OTHER_SHOP_URL);
    await harness.waitForCardImageFetches();

    expect(fetchCardImage).toHaveBeenLastCalledWith(OTHER_SHOP_URL);
    expect(Buffer.compare((await readProductImage(product.id)) ?? Buffer.alloc(0), Buffer.from(CARD_PNG))).toBe(0);
    expect(listStoredImageFiles()).toHaveLength(1);
  });

  it('URL を変えて新しい URL では取れなかった場合、前の URL のカード画像は表示しない', async () => {
    createHarness(createFakeFetch({ [SHOP_URL]: CARD_JPEG }));
    const product = await createProductThroughApi();
    await harness.waitForCardImageFetches();

    await updateProductThroughApi(product.id, OTHER_SHOP_URL);
    await harness.waitForCardImageFetches();

    expect((await findFirstListedProduct())?.imageUrl).toBeNull();
    expect(listStoredImageFiles()).toEqual([]);
  });

  it('URL を消した場合、カード画像とそのファイルを消す', async () => {
    createHarness(createFakeFetch());
    const product = await createProductThroughApi();
    await harness.waitForCardImageFetches();

    await updateProductThroughApi(product.id, null);
    await harness.waitForCardImageFetches();

    expect((await findFirstListedProduct())?.imageUrl).toBeNull();
    expect(listStoredImageFiles()).toEqual([]);
  });

  it('取りに行っている間に URL を変えた場合、前の URL の結果は使わない', async () => {
    const deferred = createDeferredFetch();
    createHarness(deferred.fetchCardImage);
    const product = await createProductThroughApi();
    const firstFinish = deferred.finish;

    await updateProductThroughApi(product.id, null);
    firstFinish(CARD_JPEG);
    await harness.waitForCardImageFetches();

    expect((await findFirstListedProduct())?.imageUrl).toBeNull();
    expect(listStoredImageFiles()).toEqual([]);
  });

  it('取りに行っている間に商品を削除した場合、結果を保存しない', async () => {
    const deferred = createDeferredFetch();
    createHarness(deferred.fetchCardImage);
    const product = await createProductThroughApi();

    await request(harness.application).delete(`/api/products/${product.id}`).expect(204);
    deferred.finish(CARD_JPEG);
    await harness.waitForCardImageFetches();

    expect(listStoredImageFiles()).toEqual([]);
  });

  it('カード画像のある商品を削除した場合、カード画像のファイルも消す', async () => {
    createHarness(createFakeFetch());
    const product = await createProductThroughApi();
    await harness.waitForCardImageFetches();

    await request(harness.application).delete(`/api/products/${product.id}`).expect(204);

    expect(listStoredImageFiles()).toEqual([]);
  });
});

describe('表示する画像の優先順位（issue #42）', () => {
  it('アップロードした画像とカード画像の両方がある場合、アップロードした画像を返す', async () => {
    createHarness(createFakeFetch());
    const product = await createProductThroughApi();
    await harness.waitForCardImageFetches();

    await request(harness.application).put(`/api/products/${product.id}/image`).send({ data: UPLOADED_JPEG.toString('base64') }).expect(200);

    expect(Buffer.compare((await readProductImage(product.id)) ?? Buffer.alloc(0), UPLOADED_JPEG)).toBe(0);
  });

  it('アップロードした画像を消した場合、カード画像を返す', async () => {
    createHarness(createFakeFetch());
    const product = await createProductThroughApi();
    await harness.waitForCardImageFetches();
    await request(harness.application).put(`/api/products/${product.id}/image`).send({ data: UPLOADED_JPEG.toString('base64') }).expect(200);

    await request(harness.application).delete(`/api/products/${product.id}/image`).expect(204);

    expect((await findFirstListedProduct())?.imageUrl).not.toBeNull();
    expect(Buffer.compare((await readProductImage(product.id)) ?? Buffer.alloc(0), Buffer.from(CARD_JPEG))).toBe(0);
  });

  it('アップロードした画像がある商品でも、カード画像を取りに行き、保存しておく', async () => {
    const fetchCardImage = createFakeFetch();
    createHarness(fetchCardImage);
    const product = await createProductThroughApi(null);
    await request(harness.application).put(`/api/products/${product.id}/image`).send({ data: UPLOADED_JPEG.toString('base64') }).expect(200);

    await updateProductThroughApi(product.id, SHOP_URL);
    await harness.waitForCardImageFetches();

    expect(fetchCardImage).toHaveBeenCalledWith(SHOP_URL);
    expect(listStoredImageFiles()).toHaveLength(2);
  });

  it('アップロードした画像とカード画像が入れ替わると、imageUrl も変わる', async () => {
    createHarness(createFakeFetch());
    const product = await createProductThroughApi();
    await harness.waitForCardImageFetches();
    const cardImageUrl = (await findFirstListedProduct())?.imageUrl;

    const uploaded = productSchema.parse(
      (await request(harness.application).put(`/api/products/${product.id}/image`).send({ data: UPLOADED_JPEG.toString('base64') }).expect(200)).body,
    );

    expect(uploaded.imageUrl).not.toBe(cardImageUrl);
  });
});
