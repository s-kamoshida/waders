import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_CURRENT_TIME, createWebApplicationTestHarness, type WebApplicationTestHarness } from './webApplicationTestHarness.ts';

/** テストで使うアカウント。 */
const LOGIN_ID = 'owner';
const PASSWORD = 'correct-horse-battery';

/** ログインした状態を保つ期間（30日）。 */
const SESSION_LIFETIME_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const MINUTE_MILLISECONDS = 60 * 1000;

let temporaryDirectory: string;
let harness: WebApplicationTestHarness;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-authentication-'));
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

/** 認証を有効・無効にしてテスト用の Web アプリケーションを組み立てる。 */
function createHarness(authenticationEnabled: boolean): WebApplicationTestHarness {
  harness = createWebApplicationTestHarness(join(temporaryDirectory, 'client'), { authenticationEnabled });
  return harness;
}

/** 現在時刻をテストの基準の時刻から進める。 */
function advanceTime(milliseconds: number): void {
  harness.setCurrentTime(new Date(TEST_CURRENT_TIME.getTime() + milliseconds));
}

/** 応答の Set-Cookie を配列で返す。 */
function readSetCookieHeaders(response: request.Response): string[] {
  const header = response.headers['set-cookie'] as string | string[] | undefined;
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

/** 応答の Set-Cookie から、次の要求に付ける Cookie（名前=値）を取り出す。 */
function extractCookie(response: request.Response): string {
  const setCookie = readSetCookieHeaders(response)[0];
  expect(setCookie).toBeDefined();
  return (setCookie ?? '').split(';')[0] ?? '';
}

/** アカウントを作成し、ログインした状態の Cookie を返す。 */
async function setUpAccount(): Promise<string> {
  const response = await request(harness.application).post('/api/auth/setup').send({ loginId: LOGIN_ID, password: PASSWORD });
  expect(response.status).toBe(201);
  return extractCookie(response);
}

/** ログインを試みる。 */
function logIn(loginId: string, password: string) {
  return request(harness.application).post('/api/auth/login').send({ loginId, password });
}

/** DB のすべての表のすべての行を文字列にする（平文で保存していないことを確かめるため）。 */
function dumpDatabase(): string {
  const tables = harness.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return JSON.stringify(tables.map((table) => harness.database.prepare(`SELECT * FROM "${table.name}"`).all()));
}

/** 認証が必要な API（状態を変えるものを含む）。 */
const PROTECTED_REQUESTS = [
  ['get', '/api/products'],
  ['post', '/api/products'],
  ['put', '/api/products/product-1'],
  ['delete', '/api/products/product-1'],
  ['get', '/api/categories'],
  ['post', '/api/categories'],
] as const;

describe('認証が無効な場合（issue #11）', () => {
  beforeEach(() => {
    createHarness(false);
  });

  it('ログインしなくても商品とカテゴリーの API を使える', async () => {
    const productsResponse = await request(harness.application).get('/api/products');
    const categoriesResponse = await request(harness.application).get('/api/categories');

    expect(productsResponse.status).toBe(200);
    expect(categoriesResponse.status).toBe(200);
  });

  it('認証の状態として、認証が無効であることを返す', async () => {
    const response = await request(harness.application).get('/api/auth/status');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ authenticationEnabled: false });
  });
});

describe('認証が有効で、アカウントがない場合（issue #11）', () => {
  beforeEach(() => {
    createHarness(true);
  });

  it('認証の状態として、アカウントがなくログインしていないことを返す', async () => {
    const response = await request(harness.application).get('/api/auth/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authenticationEnabled: true, accountExists: false, loggedIn: false });
  });

  it('商品の API は 401 を返す', async () => {
    const response = await request(harness.application).get('/api/products');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('アカウントを作成した場合、201 を返し、ログインした状態の Cookie（HttpOnly・SameSite=Strict・30日）を付ける', async () => {
    const response = await request(harness.application).post('/api/auth/setup').send({ loginId: LOGIN_ID, password: PASSWORD });

    expect(response.status).toBe(201);
    const setCookie = readSetCookieHeaders(response)[0] ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Max-Age=2592000/i);
  });

  it('アカウントを作成した場合、その Cookie で商品の API を使え、状態はログインした状態になる', async () => {
    const cookie = await setUpAccount();

    const productsResponse = await request(harness.application).get('/api/products').set('Cookie', cookie);
    const statusResponse = await request(harness.application).get('/api/auth/status').set('Cookie', cookie);

    expect(productsResponse.status).toBe(200);
    expect(statusResponse.body).toEqual({ authenticationEnabled: true, accountExists: true, loggedIn: true });
  });

  it('アカウントを作成した場合、パスワードとログインの Cookie の値を DB に平文で保存しない', async () => {
    const cookie = await setUpAccount();
    const cookieValue = cookie.split('=').slice(1).join('=');

    const databaseContent = dumpDatabase();

    expect(databaseContent).not.toContain(PASSWORD);
    expect(cookieValue.length).toBeGreaterThan(0);
    expect(databaseContent).not.toContain(cookieValue);
  });

  it('アカウントがすでにある場合、2つ目のアカウントは作れず 409 を返す', async () => {
    await setUpAccount();

    const response = await request(harness.application).post('/api/auth/setup').send({ loginId: 'other', password: 'another-password' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACCOUNT_ALREADY_EXISTS');
    expect((await logIn('other', 'another-password')).status).toBe(401);
  });

  it.each([
    ['ID が空白だけの', { loginId: '   ', password: PASSWORD }, 'loginId'],
    ['ID が 50 文字を超える', { loginId: 'a'.repeat(51), password: PASSWORD }, 'loginId'],
    ['パスワードが 8 文字未満の', { loginId: LOGIN_ID, password: 'a'.repeat(7) }, 'password'],
    ['パスワードが 128 文字を超える', { loginId: LOGIN_ID, password: 'a'.repeat(129) }, 'password'],
  ])('%s場合、400 と項目の誤りを返し、アカウントを作らない', async (_label, requestBody, field) => {
    const response = await request(harness.application).post('/api/auth/setup').send(requestBody);

    expect(response.status).toBe(400);
    expect(response.body.error.fieldErrors).toHaveProperty(field);
    expect((await request(harness.application).get('/api/auth/status')).body.accountExists).toBe(false);
  });

  it('ID が 50 文字、パスワードが 8 文字の場合、アカウントを作れる（境界）', async () => {
    const response = await request(harness.application).post('/api/auth/setup').send({ loginId: 'a'.repeat(50), password: 'a'.repeat(8) });

    expect(response.status).toBe(201);
  });

  it('ID の前後の空白を除いて保存する', async () => {
    await request(harness.application).post('/api/auth/setup').send({ loginId: `  ${LOGIN_ID}  `, password: PASSWORD });

    expect((await logIn(LOGIN_ID, PASSWORD)).status).toBe(200);
  });
});

describe('認証が有効で、アカウントがある場合（issue #11）', () => {
  beforeEach(async () => {
    createHarness(true);
    await setUpAccount();
  });

  it.each(PROTECTED_REQUESTS)('ログインしていない場合、%s %s は 401 を返す', async (method, path) => {
    const response = await request(harness.application)[method](path).set('Content-Type', 'application/json').send('{}');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('ログインしていない場合も、動作確認（/api/health）と認証の状態は使える', async () => {
    const healthResponse = await request(harness.application).get('/api/health');
    const statusResponse = await request(harness.application).get('/api/auth/status');

    expect(healthResponse.status).toBe(200);
    expect(statusResponse.body).toEqual({ authenticationEnabled: true, accountExists: true, loggedIn: false });
  });

  it('ログインしていない場合も、画面のファイル（index.html）は返す（画面がログインの画面を表示するため）', async () => {
    const clientBuildDirectory = join(temporaryDirectory, 'client');
    mkdirSync(clientBuildDirectory, { recursive: true });
    writeFileSync(join(clientBuildDirectory, 'index.html'), '<!doctype html><title>Waders</title>');
    createHarness(true);

    const response = await request(harness.application).get('/archive');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>Waders</title>');
  });

  it('正しい ID とパスワードでログインした場合、200 と Cookie を返し、その Cookie で商品の API を使える', async () => {
    const response = await logIn(LOGIN_ID, PASSWORD);
    const cookie = extractCookie(response);

    expect(response.status).toBe(200);
    expect((await request(harness.application).get('/api/products').set('Cookie', cookie)).status).toBe(200);
  });

  it('パスワードが誤りの場合と ID が誤りの場合で、同じ 401 と同じ文言を返す（どちらが誤りかを示さない）', async () => {
    const wrongPasswordResponse = await logIn(LOGIN_ID, 'wrong-password');
    const wrongIdResponse = await logIn('someone', PASSWORD);

    expect(wrongPasswordResponse.status).toBe(401);
    expect(wrongIdResponse.status).toBe(401);
    expect(wrongPasswordResponse.body).toEqual(wrongIdResponse.body);
    expect(wrongPasswordResponse.body.error.code).toBe('LOGIN_FAILED');
    expect(readSetCookieHeaders(wrongPasswordResponse)).toEqual([]);
  });

  it('偽の Cookie の場合、401 を返す', async () => {
    const cookie = extractCookie(await logIn(LOGIN_ID, PASSWORD));
    const forgedCookie = `${cookie.split('=')[0]}=forged-token`;

    const response = await request(harness.application).get('/api/products').set('Cookie', forgedCookie);

    expect(response.status).toBe(401);
  });

  it('Content-Type が application/json でないログインの要求は 415 を返す（CSRF 対策）', async () => {
    const response = await request(harness.application)
      .post('/api/auth/login')
      .type('form')
      .send(`loginId=${LOGIN_ID}&password=${PASSWORD}`);

    expect(response.status).toBe(415);
  });

  describe('ログインの失敗が続いた場合', () => {
    /** 誤ったパスワードで指定の回数ログインを試みる。 */
    async function failLogIn(times: number): Promise<void> {
      for (let attempt = 0; attempt < times; attempt += 1) {
        expect((await logIn(LOGIN_ID, 'wrong-password')).status).toBe(401);
      }
    }

    it('5回続けて失敗した場合、正しいパスワードでも 429 を返してログインできない', async () => {
      await failLogIn(5);

      const response = await logIn(LOGIN_ID, PASSWORD);

      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('LOGIN_LOCKED');
      expect(readSetCookieHeaders(response)).toEqual([]);
    });

    it('4回続けて失敗しても、5回目に正しいパスワードならログインできる', async () => {
      await failLogIn(4);

      expect((await logIn(LOGIN_ID, PASSWORD)).status).toBe(200);
    });

    it('ログインに成功した場合、失敗の回数を数え直す', async () => {
      await failLogIn(4);
      await logIn(LOGIN_ID, PASSWORD);
      await failLogIn(4);

      expect((await logIn(LOGIN_ID, PASSWORD)).status).toBe(200);
    });

    it('ID が誤りの失敗も回数に数える', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) await logIn(`someone-${attempt}`, 'wrong-password');

      expect((await logIn(LOGIN_ID, PASSWORD)).status).toBe(429);
    });

    it('制限されてから 15 分たつまではログインできず、15 分たつとログインできる', async () => {
      await failLogIn(5);

      advanceTime(15 * MINUTE_MILLISECONDS - 1000);
      expect((await logIn(LOGIN_ID, PASSWORD)).status).toBe(429);

      advanceTime(15 * MINUTE_MILLISECONDS);
      expect((await logIn(LOGIN_ID, PASSWORD)).status).toBe(200);
    });

    it('制限されている間も、ログイン済みの Cookie では商品の API を使える', async () => {
      const cookie = extractCookie(await logIn(LOGIN_ID, PASSWORD));
      await failLogIn(5);

      expect((await request(harness.application).get('/api/products').set('Cookie', cookie)).status).toBe(200);
    });
  });

  describe('ログインした状態の期間', () => {
    it('最後に使ってから 30 日たつまでは使え、使うたびに期間が延びる', async () => {
      const cookie = extractCookie(await logIn(LOGIN_ID, PASSWORD));

      advanceTime(29 * DAY_MILLISECONDS);
      expect((await request(harness.application).get('/api/products').set('Cookie', cookie)).status).toBe(200);

      advanceTime(58 * DAY_MILLISECONDS);
      expect((await request(harness.application).get('/api/products').set('Cookie', cookie)).status).toBe(200);
    });

    it('最後に使ってから 30 日たった場合、401 を返す', async () => {
      const cookie = extractCookie(await logIn(LOGIN_ID, PASSWORD));

      advanceTime(SESSION_LIFETIME_MILLISECONDS);

      expect((await request(harness.application).get('/api/products').set('Cookie', cookie)).status).toBe(401);
    });

    it('使った場合、Cookie の有効期間（30日）を付け直す', async () => {
      const cookie = extractCookie(await logIn(LOGIN_ID, PASSWORD));
      advanceTime(DAY_MILLISECONDS);

      const response = await request(harness.application).get('/api/products').set('Cookie', cookie);

      expect(readSetCookieHeaders(response)[0]).toMatch(/Max-Age=2592000/i);
    });
  });

  describe('ログアウト', () => {
    it('ログアウトした場合、204 を返して Cookie を消し、その Cookie では使えなくなる', async () => {
      const cookie = extractCookie(await logIn(LOGIN_ID, PASSWORD));

      const response = await request(harness.application).post('/api/auth/logout').set('Content-Type', 'application/json').set('Cookie', cookie);

      expect(response.status).toBe(204);
      expect(readSetCookieHeaders(response)[0]).toMatch(/Max-Age=0/i);
      expect((await request(harness.application).get('/api/products').set('Cookie', cookie)).status).toBe(401);
    });

    it('ログアウトしても、別の端末でログインした状態は保つ', async () => {
      const firstCookie = extractCookie(await logIn(LOGIN_ID, PASSWORD));
      const secondCookie = extractCookie(await logIn(LOGIN_ID, PASSWORD));

      await request(harness.application).post('/api/auth/logout').set('Content-Type', 'application/json').set('Cookie', firstCookie);

      expect((await request(harness.application).get('/api/products').set('Cookie', secondCookie)).status).toBe(200);
    });
  });

  describe('アカウントを消した場合（パスワードを忘れた場合の再設定）', () => {
    it('アカウントとログインした状態を消し、作成の画面からアカウントを作り直せる。商品は残る', async () => {
      const cookie = extractCookie(await logIn(LOGIN_ID, PASSWORD));
      await request(harness.application)
        .post('/api/products')
        .set('Cookie', cookie)
        .send({ name: '残る商品', releaseMonth: '2026-12' })
        .expect(201);

      harness.authenticationService.resetAccount();

      expect((await request(harness.application).get('/api/products').set('Cookie', cookie)).status).toBe(401);
      expect((await request(harness.application).get('/api/auth/status')).body).toEqual({
        authenticationEnabled: true,
        accountExists: false,
        loggedIn: false,
      });
      const newCookie = extractCookie(
        await request(harness.application).post('/api/auth/setup').send({ loginId: 'new-owner', password: 'new-password' }),
      );
      const productsResponse = await request(harness.application).get('/api/products').set('Cookie', newCookie);
      expect(productsResponse.body.products.map((product: { name: string }) => product.name)).toEqual(['残る商品']);
    });
  });
});

describe('ログインの失敗の制限を接続元ごとに数える（issue #36）', () => {
  beforeEach(async () => {
    createHarness(true);
    await setUpAccount();
  });

  it('この端末から5回続けて失敗しても、ほかの接続元からはログインできる', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await logIn(LOGIN_ID, 'wrong-password')).status).toBe(401);
    }

    expect((await logIn(LOGIN_ID, PASSWORD)).status).toBe(429);
    await expect(harness.authenticationService.logIn(LOGIN_ID, PASSWORD, '192.168.1.20')).resolves.toEqual(expect.any(String));
  });

  it('ほかの接続元から5回続けて失敗しても、この端末からはログインできる', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(harness.authenticationService.logIn(LOGIN_ID, 'wrong-password', '192.168.1.66')).rejects.toThrow();
    }

    expect((await logIn(LOGIN_ID, PASSWORD)).status).toBe(200);
  });

  it('この端末（ループバック）の接続元で5回続けて失敗した場合、この端末からの要求は制限する', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(harness.authenticationService.logIn(LOGIN_ID, 'wrong-password', '127.0.0.1')).rejects.toThrow();
    }

    expect((await logIn(LOGIN_ID, PASSWORD)).status).toBe(429);
  });
});

describe('画面と API を置くパスの下での Cookie（issue #39）', () => {
  it('basePath が /waders の場合、ログインした状態の Cookie の Path を /waders にする', async () => {
    harness = createWebApplicationTestHarness(join(temporaryDirectory, 'client'), { authenticationEnabled: true, basePath: '/waders' });

    const response = await request(harness.application).post('/waders/api/auth/setup').send({ loginId: LOGIN_ID, password: PASSWORD });

    expect(response.status).toBe(201);
    const setCookie = readSetCookieHeaders(response)[0] ?? '';
    expect(setCookie).toMatch(/Path=\/waders(;|$)/i);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
  });

  it('basePath が /waders の場合、作った Cookie で /waders/api の商品の一覧を取得できる', async () => {
    harness = createWebApplicationTestHarness(join(temporaryDirectory, 'client'), { authenticationEnabled: true, basePath: '/waders' });
    const setupResponse = await request(harness.application).post('/waders/api/auth/setup').send({ loginId: LOGIN_ID, password: PASSWORD });
    const cookie = extractCookie(setupResponse);

    const response = await request(harness.application).get('/waders/api/products').set('Cookie', cookie);

    expect(response.status).toBe(200);
  });

  it('basePath が /waders の場合、ログアウトで Cookie を消すときも Path を /waders にする', async () => {
    harness = createWebApplicationTestHarness(join(temporaryDirectory, 'client'), { authenticationEnabled: true, basePath: '/waders' });
    const setupResponse = await request(harness.application).post('/waders/api/auth/setup').send({ loginId: LOGIN_ID, password: PASSWORD });
    const cookie = extractCookie(setupResponse);

    const response = await request(harness.application).post('/waders/api/auth/logout').set('Content-Type', 'application/json').set('Cookie', cookie);

    expect(response.status).toBe(204);
    const clearCookie = readSetCookieHeaders(response)[0] ?? '';
    expect(clearCookie).toMatch(/Path=\/waders(;|$)/i);
  });
});
