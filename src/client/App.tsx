/**
 * 画面の最上位のコンポーネント。
 *
 * 所属: クライアント
 * 責務: 画面全体の枠（ヘッダー）と、商品の一覧の画面を描画する。
 */
import { ProductListPage } from './pages/ProductListPage.tsx';

/** 画面全体を描画する。 */
export function App() {
  return (
    <div className="application">
      <header className="application-header">
        <h1 className="application-title">Waders</h1>
      </header>
      <main className="application-main">
        <ProductListPage currentTime={new Date()} />
      </main>
    </div>
  );
}
