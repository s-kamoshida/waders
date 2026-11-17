import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { SETTINGS_TEMPLATE_FILE_PATH, loadServerSettings } from './src/server/serverSettings.ts';

/**
 * Vite 設定（画面のビルドと開発サーバー）。
 * - ルートは src/client。ビルド成果物は dist/client に出力し、本番ではサーバーが配信する。
 * - 開発時は /api へのリクエストを、サーバーと同じ設定（設定ファイル・環境変数）で決まるポートへ転送する。
 */
const serverSettings = loadServerSettings({
  environment: process.env,
  templateFilePath: SETTINGS_TEMPLATE_FILE_PATH,
  workingDirectory: process.cwd(),
});

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${serverSettings.port}` },
  },
});
