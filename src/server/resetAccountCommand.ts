/**
 * アカウントを消すコマンド（パスワードを忘れた場合の再設定。issue #11）。
 *
 * 所属: コンポジションルート（サーバーとは別に実行するコマンド）
 * 責務: 設定からデータのフォルダを求め、DB のアカウントとすべてのログインした状態を消す。商品・カテゴリーなどは消さない。
 *  消した後に画面を開くと、アカウントの作成の画面になる。サーバーを止めずに実行してよい（ログインした状態はすぐに使えなくなる）。
 * 実行: `npm run reset-account`（データのフォルダを変えている場合は、サーバーと同じ環境変数 WADERS_DATA_DIRECTORY を付ける）
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createAuthenticationService } from './application/authenticationService.ts';
import { createSqliteAccountRepository } from './infrastructure/sqliteAccountRepository.ts';
import { openProductDatabase } from './infrastructure/sqliteProductRepository.ts';
import {
  DATABASE_FILE_NAME,
  DEFAULT_DATA_DIRECTORY_NAME,
  SETTINGS_FILE_NAME,
  SETTINGS_TEMPLATE_FILE_PATH,
  ServerSettingsError,
  loadServerSettings,
} from './serverSettings.ts';

/** アカウントを消す。終了コードは成功で 0、失敗で 1。 */
function resetAccount(): number {
  // データのフォルダを誤って指定した場合に、設定ファイルや DB を新しく作らないよう、先に存在を確かめる
  const dataDirectory = resolve(process.cwd(), process.env.WADERS_DATA_DIRECTORY ?? DEFAULT_DATA_DIRECTORY_NAME);
  if (!existsSync(join(dataDirectory, SETTINGS_FILE_NAME)) || !existsSync(join(dataDirectory, DATABASE_FILE_NAME))) {
    console.error(`データのフォルダに Waders のデータがありません: ${dataDirectory}\nWaders のフォルダで実行しているか、環境変数 WADERS_DATA_DIRECTORY がサーバーと同じかを確かめてください。`);
    return 1;
  }
  let settings;
  try {
    settings = loadServerSettings({ environment: process.env, templateFilePath: SETTINGS_TEMPLATE_FILE_PATH, workingDirectory: process.cwd() });
  } catch (error) {
    if (!(error instanceof ServerSettingsError)) throw error;
    console.error(`設定に誤りがあるため実行できません。\n${error.message}`);
    return 1;
  }
  const databaseFilePath = join(settings.dataDirectory, DATABASE_FILE_NAME);
  const database = openProductDatabase(databaseFilePath);
  try {
    const authenticationService = createAuthenticationService({
      accountRepository: createSqliteAccountRepository(database),
      clock: { now: () => new Date() },
      authenticationEnabled: settings.authenticationEnabled,
    });
    authenticationService.resetAccount();
  } finally {
    database.close();
  }
  console.log(`アカウントを消しました（${databaseFilePath}）。画面を開き直して、アカウントを作り直してください。`);
  return 0;
}

process.exitCode = resetAccount();
