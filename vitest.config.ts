import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vitest 設定。
 * - テストは src/test 配下に、本体（src/client・src/server・src/shared）と同じ構成で *.test.ts(x) として置く。
 * - クライアントのテストはファイル先頭の `// @vitest-environment jsdom` で DOM 環境に切り替える。
 * - 発売月・受注期限の判定を日本時間で行うため、タイムゾーンを Asia/Tokyo に固定する。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    env: { TZ: 'Asia/Tokyo' },
  },
});
