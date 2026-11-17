/**
 * テスト共通の初期化。
 * - jest-dom のマッチャー（toBeInTheDocument など）を有効にする
 * - React Testing Library の描画結果を各テスト後に片付ける
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
