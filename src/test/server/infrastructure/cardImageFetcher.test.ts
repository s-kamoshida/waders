import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CARD_IMAGE_FETCH_LIMITS,
  createCardImageFetcher,
  extractCardImageUrl,
  isPublicNetworkAddress,
} from '../../../server/infrastructure/cardImageFetcher.ts';

const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 3)]);
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 4)]);

describe('カード画像の URL の取り出し（issue #42）', () => {
  const pageUrl = 'https://shop.example.jp/item/1';

  it('og:image の URL を取り出す', () => {
    const html = '<html><head><meta property="og:image" content="https://cdn.example.jp/a.jpg"></head></html>';

    expect(extractCardImageUrl(html, pageUrl)).toBe('https://cdn.example.jp/a.jpg');
  });

  it('属性の順番が逆でも、引用符が単引用符でも取り出す', () => {
    const html = "<meta content='https://cdn.example.jp/b.jpg' property='og:image' />";

    expect(extractCardImageUrl(html, pageUrl)).toBe('https://cdn.example.jp/b.jpg');
  });

  it('og:image がなければ、twitter:image を使う', () => {
    const html = '<meta name="twitter:image" content="https://cdn.example.jp/c.jpg">';

    expect(extractCardImageUrl(html, pageUrl)).toBe('https://cdn.example.jp/c.jpg');
  });

  it('og:image と twitter:image の両方がある場合、og:image を使う', () => {
    const html = '<meta name="twitter:image" content="https://cdn.example.jp/t.jpg"><meta property="og:image" content="https://cdn.example.jp/o.jpg">';

    expect(extractCardImageUrl(html, pageUrl)).toBe('https://cdn.example.jp/o.jpg');
  });

  it('相対パスの場合、ページの URL を基準にした URL にする', () => {
    const html = '<meta property="og:image" content="/images/d.jpg">';

    expect(extractCardImageUrl(html, pageUrl)).toBe('https://shop.example.jp/images/d.jpg');
  });

  it('文字参照（&amp;）を戻す', () => {
    const html = '<meta property="og:image" content="https://cdn.example.jp/e.jpg?w=800&amp;h=600">';

    expect(extractCardImageUrl(html, pageUrl)).toBe('https://cdn.example.jp/e.jpg?w=800&h=600');
  });

  it.each([
    ['画像の指定がない', '<html><head><title>商品</title></head></html>'],
    ['content が空', '<meta property="og:image" content="">'],
    ['javascript: の URL', '<meta property="og:image" content="javascript:alert(1)">'],
    ['data: の URL', '<meta property="og:image" content="data:image/png;base64,AAAA">'],
    ['file: の URL', '<meta property="og:image" content="file:///etc/passwd">'],
  ])('使える画像の URL がない（%s）場合、null を返す', (_label, html) => {
    expect(extractCardImageUrl(html, pageUrl)).toBeNull();
  });
});

describe('接続してよいアドレスの判定（issue #42。SSRF 対策）', () => {
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])('インターネットのアドレス（%s）は接続してよい', (address) => {
    expect(isPublicNetworkAddress(address)).toBe(true);
  });

  it.each([
    ['ループバック', '127.0.0.1'],
    ['ループバック（127/8 の別のアドレス）', '127.1.2.3'],
    ['LAN（10/8）', '10.0.0.5'],
    ['LAN（172.16/12）', '172.20.1.1'],
    ['LAN（192.168/16）', '192.168.1.10'],
    ['リンクローカル（クラウドのメタデータを含む）', '169.254.169.254'],
    ['CGNAT（100.64/10）', '100.64.0.1'],
    ['未指定', '0.0.0.0'],
    ['マルチキャスト', '224.0.0.1'],
    ['ブロードキャスト', '255.255.255.255'],
    ['予約（240/4）', '240.0.0.1'],
    ['IPv6 のループバック', '::1'],
    ['IPv6 の未指定', '::'],
    ['IPv6 のユニークローカル', 'fd12:3456:789a::1'],
    ['IPv6 のリンクローカル', 'fe80::1'],
    ['IPv6 のマルチキャスト', 'ff02::1'],
    ['IPv4 を IPv6 の形で表した LAN のアドレス', '::ffff:192.168.1.10'],
    ['IPv4 を IPv6 の形で表したループバック', '::ffff:127.0.0.1'],
    ['アドレスでない文字列', 'raspberrypi.local'],
  ])('%s（%s）は接続しない', (_label, address) => {
    expect(isPublicNetworkAddress(address)).toBe(false);
  });
});

describe('カード画像の取得の上限（issue #42）', () => {
  it('全体で 10 秒、ページは先頭の 1MB、画像は 2MB、リダイレクトは 3 回まで', () => {
    expect(CARD_IMAGE_FETCH_LIMITS).toEqual({
      timeoutMilliseconds: 10_000,
      maximumPageBytes: 1024 * 1024,
      maximumImageBytes: 2 * 1024 * 1024,
      maximumRedirects: 3,
    });
  });
});

describe('カード画像の取得（issue #42）', () => {
  let server: Server | undefined;
  /** 受け取ったリクエストのパス（受け取った順）。 */
  let receivedPaths: string[];

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server === undefined) resolve();
      else server.close(() => resolve());
    });
    server = undefined;
  });

  /** テスト用の HTTP サーバーを 127.0.0.1 で起動し、その URL の先頭（http://127.0.0.1:ポート）を返す。 */
  async function startServer(handle: (request: IncomingMessage, response: ServerResponse, origin: string) => void): Promise<string> {
    receivedPaths = [];
    let origin = '';
    server = createServer((request, response) => {
      receivedPaths.push(request.url ?? '');
      handle(request, response, origin);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return origin;
  }

  /** テスト用のサーバー（127.0.0.1）にだけ接続してよいことにした取得の処理を作る。 */
  function createFetcherForTestServer(options: { timeoutMilliseconds?: number } = {}) {
    return createCardImageFetcher({ isAllowedAddress: (address) => address === '127.0.0.1', ...options });
  }

  /** ページを返すサーバーの処理（og:image に画像のパスを書く）。 */
  function respondPageAndImage(image: Buffer, imageContentType = 'image/jpeg') {
    return (request: IncomingMessage, response: ServerResponse) => {
      if (request.url === '/item') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<html><head><meta property="og:image" content="/card.jpg"></head><body>商品</body></html>');
        return;
      }
      response.writeHead(200, { 'Content-Type': imageContentType });
      response.end(image);
    };
  }

  it('ページの og:image の画像を取り、中身と形式を返す', async () => {
    const origin = await startServer(respondPageAndImage(JPEG_BYTES));

    const result = await createFetcherForTestServer().fetchCardImage(`${origin}/item`);

    expect(result?.format).toBe('jpeg');
    expect(Buffer.compare(Buffer.from(result?.bytes ?? []), JPEG_BYTES)).toBe(0);
    expect(receivedPaths).toEqual(['/item', '/card.jpg']);
  });

  it('画像の形式は、Content-Type ではなく中身で判定する', async () => {
    const origin = await startServer(respondPageAndImage(PNG_BYTES, 'image/jpeg'));

    expect((await createFetcherForTestServer().fetchCardImage(`${origin}/item`))?.format).toBe('png');
  });

  it('画像の中身が受け付けない形式（SVG など）の場合、null を返す', async () => {
    const origin = await startServer(respondPageAndImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml'));

    expect(await createFetcherForTestServer().fetchCardImage(`${origin}/item`)).toBeNull();
  });

  it('画像が 2MB を超える場合、null を返す', async () => {
    const origin = await startServer(respondPageAndImage(Buffer.concat([JPEG_BYTES, Buffer.alloc(2 * 1024 * 1024, 1)])));

    expect(await createFetcherForTestServer().fetchCardImage(`${origin}/item`)).toBeNull();
  });

  it('ページが 1MB を超えても、先頭の 1MB にある og:image は使う', async () => {
    const origin = await startServer((request, response) => {
      if (request.url === '/item') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(`<head><meta property="og:image" content="/card.jpg"></head><body>${'あ'.repeat(1024 * 1024)}</body>`);
        return;
      }
      response.writeHead(200, { 'Content-Type': 'image/jpeg' });
      response.end(JPEG_BYTES);
    });

    expect((await createFetcherForTestServer().fetchCardImage(`${origin}/item`))?.format).toBe('jpeg');
  });

  it('ページが HTML でない場合、画像を取りに行かずに null を返す', async () => {
    const origin = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"og:image": "/card.jpg"}');
    });

    expect(await createFetcherForTestServer().fetchCardImage(`${origin}/item`)).toBeNull();
    expect(receivedPaths).toEqual(['/item']);
  });

  it('ページが 200 以外（403 など）の場合、null を返す', async () => {
    const origin = await startServer((_request, response) => {
      response.writeHead(403, { 'Content-Type': 'text/html' });
      response.end('<meta property="og:image" content="/card.jpg">');
    });

    expect(await createFetcherForTestServer().fetchCardImage(`${origin}/item`)).toBeNull();
  });

  it('リダイレクトは 3 回までたどる', async () => {
    const origin = await startServer((request, response) => {
      const step = Number(/^\/step-(\d)$/.exec(request.url ?? '')?.[1] ?? '-1');
      if (step >= 0 && step < 3) {
        response.writeHead(302, { Location: `/step-${step + 1}` });
        response.end();
        return;
      }
      respondPageAndImage(JPEG_BYTES)({ ...request, url: request.url === '/step-3' ? '/item' : request.url } as IncomingMessage, response);
    });

    expect((await createFetcherForTestServer().fetchCardImage(`${origin}/step-0`))?.format).toBe('jpeg');
  });

  it('リダイレクトが 3 回を超える場合、null を返す', async () => {
    const origin = await startServer((request, response) => {
      const step = Number(/^\/step-(\d)$/.exec(request.url ?? '')?.[1] ?? '0');
      response.writeHead(302, { Location: `/step-${step + 1}` });
      response.end();
    });

    expect(await createFetcherForTestServer().fetchCardImage(`${origin}/step-0`)).toBeNull();
    expect(receivedPaths).toHaveLength(4);
  });

  it('リダイレクトの先が接続してはいけないアドレスの場合、接続せずに null を返す', async () => {
    const origin = await startServer((_request, response) => {
      response.writeHead(302, { Location: 'http://10.0.0.1/admin' });
      response.end();
    });

    expect(await createFetcherForTestServer().fetchCardImage(`${origin}/item`)).toBeNull();
    expect(receivedPaths).toEqual(['/item']);
  });

  it('og:image の画像が接続してはいけないアドレスの場合、接続せずに null を返す', async () => {
    const origin = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<meta property="og:image" content="http://192.168.1.1/router.png">');
    });

    expect(await createFetcherForTestServer().fetchCardImage(`${origin}/item`)).toBeNull();
    expect(receivedPaths).toEqual(['/item']);
  });

  it('既定の判定では、ループバックのアドレスのページに接続しない', async () => {
    const origin = await startServer(respondPageAndImage(JPEG_BYTES));

    expect(await createCardImageFetcher().fetchCardImage(`${origin}/item`)).toBeNull();
    expect(receivedPaths).toEqual([]);
  });

  it('既定の判定では、名前を引いた先がループバックのアドレス（localhost）の場合も接続しない', async () => {
    const origin = await startServer(respondPageAndImage(JPEG_BYTES));

    expect(await createCardImageFetcher().fetchCardImage(origin.replace('127.0.0.1', 'localhost') + '/item')).toBeNull();
    expect(receivedPaths).toEqual([]);
  });

  it.each(['ftp://shop.example.jp/item', 'file:///etc/passwd', 'javascript:alert(1)', 'URL ではない'])(
    'http・https でない URL（%s）の場合、null を返す',
    async (pageUrl) => {
      expect(await createCardImageFetcher().fetchCardImage(pageUrl)).toBeNull();
    },
  );

  it('時間の上限を超えた場合、待たずに null を返す', async () => {
    const origin = await startServer(() => {
      // 応答しない
    });
    const startedAt = Date.now();

    const result = await createFetcherForTestServer({ timeoutMilliseconds: 300 }).fetchCardImage(`${origin}/item`);

    expect(result).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });

  it('購入先へ Cookie を送らない', async () => {
    let cookieHeader: string | undefined;
    const origin = await startServer((request, response) => {
      cookieHeader = request.headers.cookie;
      respondPageAndImage(JPEG_BYTES)(request, response);
    });

    await createFetcherForTestServer().fetchCardImage(`${origin}/item`);

    expect(cookieHeader).toBeUndefined();
  });
});
