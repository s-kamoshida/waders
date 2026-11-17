/**
 * サーバーのエントリーポイント（コンポジションルート）。
 *
 * 責務:
 *  - 設定の読み込み（設定ファイルがなければひな形から作成）
 *  - Web アプリケーションの組み立てと、HTTP サーバーの起動
 *  - 終了シグナルを受けたときの後始末
 * 実行: `node src/server/main.ts`（Node.js 24 の型除去機能で TypeScript を直接実行する）
 */
import { resolve } from 'node:path';
import { createWebApplication } from './presentation/webApplication.ts';
import { SETTINGS_TEMPLATE_FILE_PATH, ServerSettingsError, loadServerSettings } from './serverSettings.ts';
import { writeStructuredLog } from './structuredLogger.ts';

const CLIENT_BUILD_DIRECTORY = resolve(import.meta.dirname, '../../dist/client');

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
  const application = createWebApplication({ clientBuildDirectory: CLIENT_BUILD_DIRECTORY });

  const server = application.listen(settings.port, (error?: Error) => {
    if (error !== undefined) {
      writeStructuredLog('error', 'サーバーを起動できません', { port: settings.port, reason: error.message });
      process.exit(1);
    }
    writeStructuredLog('info', 'サーバーを起動しました', {
      url: `http://localhost:${settings.port}`,
      dataDirectory: settings.dataDirectory,
    });
  });

  const shutdown = (signal: string): void => {
    writeStructuredLog('info', 'サーバーを停止します', { signal });
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer();
