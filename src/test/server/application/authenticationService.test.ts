import { beforeEach, describe, expect, it } from 'vitest';
import { createAuthenticationService, type AuthenticationService } from '../../../server/application/authenticationService.ts';
import { LoginFailedError, LoginLockedError } from '../../../server/domain/account.ts';
import { createSqliteAccountRepository } from '../../../server/infrastructure/sqliteAccountRepository.ts';
import { openProductDatabase } from '../../../server/infrastructure/sqliteProductRepository.ts';

/** テストで使うアカウント。 */
const LOGIN_ID = 'owner';
const PASSWORD = 'correct-horse-battery';

/** 持ち主の端末と、ほかの端末の接続元。 */
const OWNER_ADDRESS = '192.168.1.20';
const OTHER_ADDRESS = '192.168.1.66';

const MINUTE_MILLISECONDS = 60 * 1000;
const START_TIME = new Date('2026-11-17T03:00:00.000Z');

let currentTime: Date;
let service: AuthenticationService;

beforeEach(async () => {
  currentTime = START_TIME;
  service = createAuthenticationService({
    accountRepository: createSqliteAccountRepository(openProductDatabase(':memory:')),
    clock: { now: () => currentTime },
    authenticationEnabled: true,
  });
  await service.setUpAccount(LOGIN_ID, PASSWORD);
});

/** 現在時刻を開始の時刻から進める。 */
function advanceTime(milliseconds: number): void {
  currentTime = new Date(START_TIME.getTime() + milliseconds);
}

/** 誤ったパスワードで、指定の接続元から指定の回数ログインを試みる（どれも失敗する）。 */
async function failLogIn(clientAddress: string, times: number): Promise<void> {
  for (let attempt = 0; attempt < times; attempt += 1) {
    await expect(service.logIn(LOGIN_ID, 'wrong-password', clientAddress)).rejects.toBeInstanceOf(LoginFailedError);
  }
}

describe('ログインの失敗の制限を接続元ごとに数える（issue #36）', () => {
  it('同じ接続元から5回続けて失敗した場合、その接続元からは正しいパスワードでもログインできない', async () => {
    await failLogIn(OWNER_ADDRESS, 5);

    await expect(service.logIn(LOGIN_ID, PASSWORD, OWNER_ADDRESS)).rejects.toBeInstanceOf(LoginLockedError);
  });

  it('ほかの接続元から5回続けて失敗しても、持ち主の接続元からは正しいパスワードでログインできる', async () => {
    await failLogIn(OTHER_ADDRESS, 5);

    await expect(service.logIn(LOGIN_ID, PASSWORD, OWNER_ADDRESS)).resolves.toEqual(expect.any(String));
  });

  it('ほかの接続元の失敗は、その接続元の失敗の回数に足さない', async () => {
    await failLogIn(OWNER_ADDRESS, 3);
    await failLogIn(OTHER_ADDRESS, 3);
    await failLogIn(OWNER_ADDRESS, 1);

    await expect(service.logIn(LOGIN_ID, PASSWORD, OWNER_ADDRESS)).resolves.toEqual(expect.any(String));
  });

  it('ある接続元でログインに成功しても、ほかの接続元の失敗の回数は数え直さない', async () => {
    await failLogIn(OTHER_ADDRESS, 4);
    await service.logIn(LOGIN_ID, PASSWORD, OWNER_ADDRESS);
    await failLogIn(OTHER_ADDRESS, 1);

    await expect(service.logIn(LOGIN_ID, PASSWORD, OTHER_ADDRESS)).rejects.toBeInstanceOf(LoginLockedError);
  });

  it('ある接続元でログインに成功した場合、その接続元の失敗の回数を数え直す', async () => {
    await failLogIn(OWNER_ADDRESS, 4);
    await service.logIn(LOGIN_ID, PASSWORD, OWNER_ADDRESS);
    await failLogIn(OWNER_ADDRESS, 4);

    await expect(service.logIn(LOGIN_ID, PASSWORD, OWNER_ADDRESS)).resolves.toEqual(expect.any(String));
  });

  it('IPv4 のアドレスと、それを IPv6 の形で表したものは、同じ接続元として数える', async () => {
    await failLogIn('::ffff:192.168.1.66', 3);
    await failLogIn('192.168.1.66', 2);

    await expect(service.logIn(LOGIN_ID, PASSWORD, '192.168.1.66')).rejects.toBeInstanceOf(LoginLockedError);
    await expect(service.logIn(LOGIN_ID, PASSWORD, '::ffff:192.168.1.66')).rejects.toBeInstanceOf(LoginLockedError);
  });

  it('制限されてから15分たつと、その接続元からログインできる', async () => {
    await failLogIn(OTHER_ADDRESS, 5);

    advanceTime(15 * MINUTE_MILLISECONDS - 1000);
    await expect(service.logIn(LOGIN_ID, PASSWORD, OTHER_ADDRESS)).rejects.toBeInstanceOf(LoginLockedError);

    advanceTime(15 * MINUTE_MILLISECONDS);
    await expect(service.logIn(LOGIN_ID, PASSWORD, OTHER_ADDRESS)).resolves.toEqual(expect.any(String));
  });

  it('アカウントを消した場合、すべての接続元の失敗の記録を消す', async () => {
    await failLogIn(OWNER_ADDRESS, 5);
    await failLogIn(OTHER_ADDRESS, 5);

    service.resetAccount();
    await service.setUpAccount(LOGIN_ID, PASSWORD);

    await expect(service.logIn(LOGIN_ID, PASSWORD, OWNER_ADDRESS)).resolves.toEqual(expect.any(String));
    await expect(service.logIn(LOGIN_ID, PASSWORD, OTHER_ADDRESS)).resolves.toEqual(expect.any(String));
  });
});
