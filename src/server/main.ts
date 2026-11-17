/**
 * サーバーのエントリーポイント（コンポジションルート）。
 *
 * 責務:
 *  - 設定の読み込み（設定ファイルがなければひな形から作成）
 *  - 商品の DB を開き、スキーマを最新の版数に移行する
 *  - ステータスの自動遷移（起動時）
 *  - 各層の組み立て（依存の注入）と、HTTP サーバーの起動
 *  - 終了シグナルを受けたときの後始末
 * 実行: `node src/server/main.ts`（Node.js 24 の型除去機能で TypeScript を直接実行する）
 */
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createProductService } from './application/productService.ts';
import type { ProductId } from './domain/product.ts';
import { createSqliteProductRepository, openProductDatabase } from './infrastructure/sqliteProductRepository.ts';
import { createWebApplication } from './presentation/webApplication.ts';
import { SETTINGS_TEMPLATE_FILE_PATH, ServerSettingsError, loadServerSettings } from './serverSettings.ts';
import { writeStructuredLog } from './structuredLogger.ts';

const CLIENT_BUILD_DIRECTORY = resolve(import.meta.dirname, '../../dist/client');

/** データのフォルダの中にある商品の DB ファイルの名前。 */
const DATABASE_FILE_NAME = 'waders.sqlite';

/** 設定を読み込む。誤りがあれば理由をログに出して終了する（誤った設定のまま動かさない）。 */
function loadSettingsOrExit() {
  try {
    return loadServerSettings({
      environment: process.env,
      templateFilePath: SETTINGS_TEMPLATE_FILE_PATH,
      workingDirectory: process.cwd(),
    });
  } catch (error) {
    if (!(error instanceof ServerSettingsError)) throw error;
    writeStructuredLog('error', '設定に誤りがあるため起動できません', { reason: error.message });
    process.exit(1);
  }
}

/** サーバーを起動する。 */
function startServer(): void {
  const settings = loadSettingsOrExit();
  const databaseFilePath = join(settings.dataDirectory, DATABASE_FILE_NAME);
  const database = openProductDatabase(databaseFilePath);
  const productService = createProductService({
    productRepository: createSqliteProductRepository(database),
    clock: { now: () => new Date() },
    generateProductId: () => randomUUID() as ProductId,
  });
  // 停止中に発売月や受注期限を超過した商品を、起動時に自動遷移させる（issue #9）
  const transitionedCount = productService.applyAutomaticTransitions();
  if (transitionedCount > 0) writeStructuredLog('info', 'ステータスを自動で変更しました', { transitionedCount });
  const application = createWebApplication({ clientBuildDirectory: CLIENT_BUILD_DIRECTORY, productService });

  const server = application.listen(settings.port, (error?: Error) => {
    if (error !== undefined) {
      writeStructuredLog('error', 'サーバーを起動できません', { port: settings.port, reason: error.message });
      process.exit(1);
    }
    writeStructuredLog('info', 'サーバーを起動しました', {
      url: `http://localhost:${settings.port}`,
      dataDirectory: settings.dataDirectory,
      databaseFilePath,
    });
  });

  const shutdown = (signal: string): void => {
    writeStructuredLog('info', 'サーバーを停止します', { signal });
    server.close(() => {
      database.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer();
