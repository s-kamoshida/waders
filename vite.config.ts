import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { SETTINGS_TEMPLATE_FILE_PATH, loadServerSettings } from './src/server/serverSettings.ts';

/**
 * Vite 設定（画面のビルドと開発サーバー）。
 * - ルートは src/client。ビルド成果物は dist/client に出力し、本番ではサーバーが配信する。
 * - 画面の部品のファイルは相対パスで読み込む（サーバーの設定の basePath を変えても、作り直さずに動かすため。issue #39）。
 * - 開発時は /api へのリクエストを、サーバーと同じ設定（設定ファイル・環境変数）で決まるポートの、basePath の下の /api へ転送する。
 *   転送するときに Host を書き換えない（サーバーは Host と Origin の一致を確かめるため。issue #35）。
 */
const serverSettings = loadServerSettings({
  environment: process.env,
  templateFilePath: SETTINGS_TEMPLATE_FILE_PATH,
  workingDirectory: process.cwd(),
});

export default defineConfig({
  root: 'src/client',
  base: './',
  plugins: [react()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    // Host を書き換えない（画面の Origin と Host を一致させ、サーバーの Host・Origin の確認を通すため。issue #35）
    proxy: {
      '/api': {
        target: `http://localhost:${serverSettings.port}`,
        changeOrigin: false,
        rewrite: (path) => `${serverSettings.basePath}${path}`,
      },
    },
  },
});
