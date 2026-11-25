import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWebApplicationTestHarness } from './webApplicationTestHarness.ts';

let temporaryDirectory: string;
let clientBuildDirectory: string;

/** テスト用の Web アプリケーションを組み立てる。 */
function createWebApplication(options: { clientBuildDirectory: string }) {
  return createWebApplicationTestHarness(options.clientBuildDirectory).application;
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-web-'));
  clientBuildDirectory = join(temporaryDirectory, 'client');
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

/** ビルド済みの画面を模したファイルを置く。 */
function writeClientBuild(): void {
  mkdirSync(clientBuildDirectory, { recursive: true });
  writeFileSync(join(clientBuildDirectory, 'index.html'), '<!doctype html><title>Waders</title>');
}

/** CSP が自サイト以外を禁止していることを確かめる。 */
function expectSelfOnlyContentSecurityPolicy(headerValue: string | undefined): void {
  expect(headerValue).toBeDefined();
  expect(headerValue).toContain("default-src 'none'");
  expect(headerValue).toContain("script-src 'self'");
  expect(headerValue).toContain("style-src 'self'");
  expect(headerValue).toContain("frame-ancestors 'none'");
  expect(headerValue).not.toContain('unsafe-inline');
  expect(headerValue).not.toContain('unsafe-eval');
}

describe('GET /api/health', () => {
  it('動作確認の要求の場合、200 と { status: "ok" } を返す', async () => {
    const response = await request(createWebApplication({ clientBuildDirectory })).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('API の応答に、自サイト以外を禁止する CSP を付ける', async () => {
    const response = await request(createWebApplication({ clientBuildDirectory })).get('/api/health');

    expectSelfOnlyContentSecurityPolicy(response.headers['content-security-policy']);
  });
});

describe('存在しない API', () => {
  it('存在しない API の場合、404 を JSON で返す', async () => {
    writeClientBuild();

    const response = await request(createWebApplication({ clientBuildDirectory })).get('/api/unknown');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
  });
});

describe('画面の配信', () => {
  it('ビルド済みの画面がある場合、/ に index.html を返し、CSP を付ける', async () => {
    writeClientBuild();

    const response = await request(createWebApplication({ clientBuildDirectory })).get('/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>Waders</title>');
    expectSelfOnlyContentSecurityPolicy(response.headers['content-security-policy']);
  });

  it('画面の URL（/archive など）の場合も index.html を返す', async () => {
    writeClientBuild();

    const response = await request(createWebApplication({ clientBuildDirectory })).get('/archive');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>Waders</title>');
  });

  it('ビルド済みの画面がない場合も、API は使える', async () => {
    const response = await request(createWebApplication({ clientBuildDirectory })).get('/api/health');

    expect(response.status).toBe(200);
  });
});

describe('Host ヘッダーの確認（issue #35。DNS リバインディング対策）', () => {
  /** 許可していない名前（攻撃者のドメイン）。 */
  const ATTACKER_HOST = 'attacker.example:8080';

  it.each([
    ['IPv4 のアドレス', '192.168.1.10:8080'],
    ['IPv6 のアドレス', '[fe80::1]:8080'],
    ['localhost', 'localhost:5173'],
    ['.local で終わる名前', 'raspberrypi.local:8080'],
    ['大文字の .local', 'RaspberryPi.LOCAL:8080'],
    ['ポートのない名前', 'raspberrypi.local'],
  ])('Host が %s の場合、API に応答する', async (_label, host) => {
    const response = await request(createWebApplication({ clientBuildDirectory })).get('/api/health').set('Host', host);

    expect(response.status).toBe(200);
  });

  it.each([
    ['攻撃者のドメイン', ATTACKER_HOST],
    ['.local を途中に含む名前', 'raspberrypi.local.attacker.example'],
    ['localhost を途中に含む名前', 'localhost.attacker.example'],
    ['.localhost で終わる名前', 'waders.localhost'],
  ])('Host が許可していない名前（%s）の場合、API に 403 を返す', async (_label, host) => {
    const response = await request(createWebApplication({ clientBuildDirectory })).get('/api/products').set('Host', host);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { code: 'HOST_NOT_ALLOWED', message: expect.any(String) } });
    expect(response.text).not.toContain('products');
  });

  it('Host が許可していない名前の場合、商品の登録を処理しない', async () => {
    const harness = createWebApplicationTestHarness(clientBuildDirectory);

    const response = await request(harness.application)
      .post('/api/products')
      .set('Host', ATTACKER_HOST)
      .send({ name: '攻撃者が登録した商品', releaseMonth: '2026-12' });

    expect(response.status).toBe(403);
    expect(harness.productService.listProducts()).toEqual([]);
  });

  it('Host が許可していない名前の場合、画面のファイルも返さない', async () => {
    writeClientBuild();

    const response = await request(createWebApplication({ clientBuildDirectory })).get('/').set('Host', ATTACKER_HOST);

    expect(response.status).toBe(403);
    expect(response.text).not.toContain('<title>Waders</title>');
  });

  it('403 の応答にも、自サイト以外を禁止する CSP を付ける', async () => {
    const response = await request(createWebApplication({ clientBuildDirectory })).get('/api/health').set('Host', ATTACKER_HOST);

    expectSelfOnlyContentSecurityPolicy(response.headers['content-security-policy']);
  });

  it('設定の allowedHosts に書いた名前の場合、大文字・小文字とポートを問わず応答する', async () => {
    const application = createWebApplicationTestHarness(clientBuildDirectory, { allowedHosts: ['waders.home.example'] }).application;

    expect((await request(application).get('/api/health').set('Host', 'waders.home.example')).status).toBe(200);
    expect((await request(application).get('/api/health').set('Host', 'Waders.Home.Example:8080')).status).toBe(200);
    expect((await request(application).get('/api/health').set('Host', 'other.home.example')).status).toBe(403);
  });
});

describe('Origin ヘッダーの確認（issue #35）', () => {
  /** 商品を登録する（Host は raspberrypi.local:8080）。 */
  function postProduct(application: ReturnType<typeof createWebApplication>, origin: string | undefined) {
    const pending = request(application).post('/api/products').set('Host', 'raspberrypi.local:8080');
    if (origin !== undefined) pending.set('Origin', origin);
    return pending.send({ name: 'フィギュア', releaseMonth: '2026-12' });
  }

  it('状態を変えるリクエストで、Origin の名前とポートが Host と一致する場合、処理する', async () => {
    const response = await postProduct(createWebApplication({ clientBuildDirectory }), 'http://raspberrypi.local:8080');

    expect(response.status).toBe(201);
  });

  it('状態を変えるリクエストで、Origin がない場合（curl など）、処理する', async () => {
    const response = await postProduct(createWebApplication({ clientBuildDirectory }), undefined);

    expect(response.status).toBe(201);
  });

  it.each([
    ['ほかのサイト', 'http://attacker.example'],
    ['ポートが違う', 'http://raspberrypi.local:8581'],
    ['名前が違う', 'http://192.168.1.10:8080'],
    ['null', 'null'],
  ])('状態を変えるリクエストで、Origin が Host と一致しない（%s）場合、403 を返して処理しない', async (_label, origin) => {
    const harness = createWebApplicationTestHarness(clientBuildDirectory);

    const response = await postProduct(harness.application, origin);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { code: 'ORIGIN_NOT_ALLOWED', message: expect.any(String) } });
    expect(harness.productService.listProducts()).toEqual([]);
  });

  it('Origin の名前の大文字・小文字は区別しない', async () => {
    const response = await postProduct(createWebApplication({ clientBuildDirectory }), 'http://RaspberryPi.Local:8080');

    expect(response.status).toBe(201);
  });

  it('読み取りのリクエスト（GET）では、Origin を確かめない', async () => {
    const response = await request(createWebApplication({ clientBuildDirectory }))
      .get('/api/health')
      .set('Host', 'raspberrypi.local:8080')
      .set('Origin', 'http://attacker.example');

    expect(response.status).toBe(200);
  });
});

describe('Host・Origin の確認を無効にした場合（issue #35。PR #37 のレビュー）', () => {
  it('許可していない名前の Host でも、API と画面のファイルに応答する', async () => {
    writeClientBuild();
    const application = createWebApplicationTestHarness(clientBuildDirectory, { hostValidationEnabled: false }).application;

    expect((await request(application).get('/api/health').set('Host', 'waders.example.com')).status).toBe(200);
    expect((await request(application).get('/').set('Host', 'waders.example.com')).status).toBe(200);
  });

  it('状態を変えるリクエストで Origin が Host と一致しなくても、処理する', async () => {
    const harness = createWebApplicationTestHarness(clientBuildDirectory, { hostValidationEnabled: false });

    const response = await request(harness.application)
      .post('/api/products')
      .set('Host', 'waders.example.com')
      .set('Origin', 'https://other.example.com')
      .send({ name: 'フィギュア', releaseMonth: '2026-12' });

    expect(response.status).toBe(201);
  });

  it('Content-Type が application/json でない状態を変えるリクエストは、今までどおり 415 を返す', async () => {
    const application = createWebApplicationTestHarness(clientBuildDirectory, { hostValidationEnabled: false }).application;

    const response = await request(application).post('/api/products').set('Host', 'waders.example.com').type('form').send('name=x');

    expect(response.status).toBe(415);
  });
});

describe('画面と API を置くパス（issue #39）', () => {
  /** basePath を /waders にしたテスト用の Web アプリケーションを組み立てる。 */
  function createApplicationUnderWaders() {
    return createWebApplicationTestHarness(clientBuildDirectory, { basePath: '/waders' }).application;
  }

  /** ビルド済みの画面を模したファイルに、画面の部品のファイルを1つ加える。 */
  function writeClientBuildWithAsset(): void {
    writeClientBuild();
    mkdirSync(join(clientBuildDirectory, 'assets'), { recursive: true });
    writeFileSync(join(clientBuildDirectory, 'assets', 'main.js'), 'console.log("waders");');
  }

  it('basePath が /waders の場合、/waders/api の下で API に応答する', async () => {
    const response = await request(createApplicationUnderWaders()).get('/waders/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('basePath が /waders の場合、/waders/api の下で商品を登録できる', async () => {
    const response = await request(createApplicationUnderWaders())
      .post('/waders/api/products')
      .send({ name: 'フィギュア', releaseMonth: '2026-12' });

    expect(response.status).toBe(201);
  });

  it('basePath が /waders の場合、/waders/ に index.html を返し、CSP を付ける', async () => {
    writeClientBuild();

    const response = await request(createApplicationUnderWaders()).get('/waders/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>Waders</title>');
    expectSelfOnlyContentSecurityPolicy(response.headers['content-security-policy']);
  });

  it('basePath が /waders の場合、画面の部品のファイルを /waders の下で返す', async () => {
    writeClientBuildWithAsset();

    const response = await request(createApplicationUnderWaders()).get('/waders/assets/main.js');

    expect(response.status).toBe(200);
    expect(response.text).toContain('waders');
  });

  it('basePath が /waders の場合、画面の URL（/waders/archive など）にも index.html を返す', async () => {
    writeClientBuild();

    const response = await request(createApplicationUnderWaders()).get('/waders/archive');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>Waders</title>');
  });

  it.each(['/', '/waders'])('basePath が /waders の場合、%s を開くと /waders/ へ転送する', async (path) => {
    writeClientBuild();

    const response = await request(createApplicationUnderWaders()).get(path);

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('/waders/');
  });

  it.each(['/api/health', '/assets/main.js', '/other'])('basePath が /waders の場合、パスの外の URL（%s）は 404 を返す', async (path) => {
    writeClientBuildWithAsset();

    const response = await request(createApplicationUnderWaders()).get(path);

    expect(response.status).toBe(404);
  });

  it('basePath が /waders の場合も、許可していない名前の Host は転送せずに 403 を返す', async () => {
    writeClientBuild();

    const response = await request(createApplicationUnderWaders()).get('/').set('Host', 'attacker.example');

    expect(response.status).toBe(403);
  });

  it('basePath が /waders の場合も、Content-Type が application/json でない状態を変えるリクエストは 415 を返す', async () => {
    const response = await request(createApplicationUnderWaders()).post('/waders/api/products').type('form').send('name=x');

    expect(response.status).toBe(415);
  });

  it('basePath が /apps/waders の場合、/apps/waders/api の下で API に応答し、/ を /apps/waders/ へ転送する', async () => {
    writeClientBuild();
    const application = createWebApplicationTestHarness(clientBuildDirectory, { basePath: '/apps/waders' }).application;

    expect((await request(application).get('/apps/waders/api/health')).status).toBe(200);
    const redirectResponse = await request(application).get('/');
    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers['location']).toBe('/apps/waders/');
  });

  it('basePath が "" の場合、今までどおり / の下で画面と API に応答し、/waders/api の下では API に応答しない', async () => {
    writeClientBuild();
    const application = createWebApplicationTestHarness(clientBuildDirectory, { basePath: '' }).application;

    expect((await request(application).get('/api/health')).status).toBe(200);
    expect((await request(application).get('/')).status).toBe(200);
    expect((await request(application).get('/waders/api/health')).status).not.toBe(200);
  });
});
