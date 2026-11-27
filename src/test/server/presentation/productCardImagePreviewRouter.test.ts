import { existsSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCardImageFetcher } from '../../../server/infrastructure/cardImageFetcher.ts';
import { productListResponseSchema } from '../../../shared/productContract.ts';
import { createWebApplicationTestHarness, type TestCardImageFetch, type WebApplicationTestHarness } from './webApplicationTestHarness.ts';

/**
 * カード画像のプレビューの API（issue #51）。
 * POST /api/products/card-image-preview に { url } を送ると、保存はせずにカード画像を取りに行き、
 * 取れたら { cardImage: { data: <base64>, format } }、取れなければ { cardImage: null } を返す。
 */
const PREVIEW_PATH = '/api/products/card-image-preview';

let harness: WebApplicationTestHarness;
let localServer: Server | undefined;

afterEach(async () => {
  harness.database.close();
  if (localServer !== undefined) await new Promise<void>((resolve) => localServer?.close(() => resolve()));
  localServer = undefined;
});

const CARD_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);
const CARD_PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 8, 8]);
const SHOP_URL = 'https://shop.example.jp/item/1';

/** URL ごとに決まったカード画像を返す、偽の取得の処理。呼ばれた URL を記録する。 */
function createFakeFetch(imagesByUrl: Record<string, Uint8Array | null> = { [SHOP_URL]: CARD_JPEG }) {
  return vi.fn<TestCardImageFetch>(async (pageUrl) => {
    const bytes = imagesByUrl[pageUrl] ?? null;
    if (bytes === null) return null;
    return { bytes, format: bytes[0] === 0x89 ? 'png' : 'jpeg' };
  });
}

/** テスト用の Web アプリケーションを組み立てる。 */
function createHarness(fetchCardImage: TestCardImageFetch, authenticationEnabled = false): WebApplicationTestHarness {
  harness = createWebApplicationTestHarness('/nonexistent-client-build', { fetchCardImage, authenticationEnabled });
  return harness;
}

/** プレビューの API に URL を送る。 */
function requestPreview(body: unknown) {
  return request(harness.application).post(PREVIEW_PATH).set('Content-Type', 'application/json').send(JSON.stringify(body));
}

/** 画像を保存するフォルダのファイルの一覧（フォルダがなければ空）。 */
function listStoredImageFiles(): string[] {
  if (!existsSync(harness.productImageDirectory)) return [];
  return readdirSync(harness.productImageDirectory);
}

describe('カード画像のプレビューの API（issue #51）', () => {
  it('カード画像を取れた場合、200 で画像の中身（base64）と、中身から判定した形式を返す', async () => {
    createHarness(createFakeFetch({ [SHOP_URL]: CARD_PNG }));

    const response = await requestPreview({ url: SHOP_URL });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cardImage: { data: Buffer.from(CARD_PNG).toString('base64'), format: 'png' } });
  });

  it('送った URL を、そのまま取得の処理（保存の後の取得と同じもの）に渡す', async () => {
    const fetchCardImage = createFakeFetch();
    createHarness(fetchCardImage);

    await requestPreview({ url: SHOP_URL });

    expect(fetchCardImage).toHaveBeenCalledTimes(1);
    expect(fetchCardImage).toHaveBeenCalledWith(SHOP_URL);
  });

  it('カード画像を取れなかった場合（null）、200 で cardImage を null にして返す', async () => {
    createHarness(createFakeFetch({}));

    const response = await requestPreview({ url: SHOP_URL });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cardImage: null });
  });

  it('取得の処理が例外を投げた場合も、500 にせず、cardImage を null にして返す', async () => {
    createHarness(
      vi.fn<TestCardImageFetch>(async () => {
        throw new Error('接続できない');
      }),
    );

    const response = await requestPreview({ url: SHOP_URL });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cardImage: null });
  });

  it('取った中身が画像の形式（JPEG・PNG・WebP）でない場合、cardImage を null にして返す', async () => {
    createHarness(vi.fn<TestCardImageFetch>(async () => ({ bytes: Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c]), format: 'jpeg' })));

    const response = await requestPreview({ url: SHOP_URL });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cardImage: null });
  });

  it('取った画像が大きさの上限（2MB）を超える場合、cardImage を null にして返す', async () => {
    const tooLarge = new Uint8Array(2 * 1024 * 1024 + 1);
    tooLarge.set(CARD_JPEG);
    createHarness(vi.fn<TestCardImageFetch>(async () => ({ bytes: tooLarge, format: 'jpeg' })));

    const response = await requestPreview({ url: SHOP_URL });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cardImage: null });
  });

  it('プレビューでは商品も画像のファイルも保存しない', async () => {
    createHarness(createFakeFetch());

    await requestPreview({ url: SHOP_URL }).expect(200);
    await harness.waitForCardImageFetches();

    expect(listStoredImageFiles()).toEqual([]);
    const listResponse = await request(harness.application).get('/api/products').expect(200);
    expect(productListResponseSchema.parse(listResponse.body).products).toEqual([]);
  });

  it('応答をブラウザに覚えさせない（Cache-Control: no-store）', async () => {
    createHarness(createFakeFetch());

    const response = await requestPreview({ url: SHOP_URL });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['http・https でない URL', { url: 'ftp://shop.example.jp/item/1' }],
    ['URL として読めない値', { url: 'shop.example.jp の商品' }],
    ['javascript: の URL', { url: 'javascript:alert(1)' }],
    ['上限（2048 文字）を超える URL', { url: `https://shop.example.jp/${'a'.repeat(2048)}` }],
    ['URL がない本文', {}],
    ['URL が文字列でない本文', { url: 123 }],
  ])('%sの場合、400（VALIDATION_ERROR と url の文言）を返し、取りに行かない', async (_label, body) => {
    const fetchCardImage = createFakeFetch();
    createHarness(fetchCardImage);

    const response = await requestPreview(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof response.body.error.fieldErrors?.url).toBe('string');
    expect(fetchCardImage).not.toHaveBeenCalled();
  });

  it('Content-Type が application/json でない場合、415 を返し、取りに行かない（CSRF 対策）', async () => {
    const fetchCardImage = createFakeFetch();
    createHarness(fetchCardImage);

    const response = await request(harness.application).post(PREVIEW_PATH).set('Content-Type', 'text/plain').send(JSON.stringify({ url: SHOP_URL }));

    expect(response.status).toBe(415);
    expect(fetchCardImage).not.toHaveBeenCalled();
  });

  it('認証が有効でログインしていない場合、401 を返し、取りに行かない', async () => {
    const fetchCardImage = createFakeFetch();
    createHarness(fetchCardImage, true);

    const response = await requestPreview({ url: SHOP_URL });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(fetchCardImage).not.toHaveBeenCalled();
  });

  it('認証が有効でログインしている場合、カード画像を返す', async () => {
    createHarness(createFakeFetch(), true);
    const setupResponse = await request(harness.application)
      .post('/api/auth/setup')
      .send({ loginId: 'owner', password: 'correct-horse-battery-staple' })
      .expect(201);
    const cookie = (setupResponse.headers['set-cookie'] as unknown as string[] | undefined)?.[0]?.split(';')[0] ?? '';

    const response = await requestPreview({ url: SHOP_URL }).set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cardImage: { data: Buffer.from(CARD_JPEG).toString('base64'), format: 'jpeg' } });
  });

  it('本物の取得の処理で LAN の中（ループバック）のアドレスの URL を送った場合、接続せず、cardImage を null にして返す（BR-34）', async () => {
    let receivedRequestCount = 0;
    localServer = createServer((_request, response) => {
      receivedRequestCount += 1;
      response.setHeader('Content-Type', 'text/html');
      response.end('<meta property="og:image" content="/image.jpg">');
    });
    await new Promise<void>((resolve) => localServer?.listen(0, '127.0.0.1', () => resolve()));
    const port = (localServer.address() as AddressInfo).port;
    createHarness(createCardImageFetcher({ timeoutMilliseconds: 2000 }).fetchCardImage);

    const response = await requestPreview({ url: `http://127.0.0.1:${port}/item` });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cardImage: null });
    expect(receivedRequestCount).toBe(0);
  });
});
