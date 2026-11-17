/**
 * クライアントのエントリーポイント。React アプリケーションを #root に描画する。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { App } from './App.tsx';
import './styles.css';

// サーバーの CSP は eval を禁止している。Zod が高速化のために eval が使えるかを試す処理を止め、
// CSP 違反の報告が出ないようにする（検証の結果は変わらない）
z.config({ jitless: true });

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('#root 要素が見つかりません');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
