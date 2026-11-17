/**
 * 画面の最上位のコンポーネント。
 *
 * 所属: クライアント
 * 責務: 画面全体の枠を描画する。現時点ではアプリ名だけを表示する（機能は今後の issue で追加する）。
 */

/** 画面全体を描画する。 */
export function App() {
  return (
    <main className="application">
      <h1 className="application-title">Waders</h1>
    </main>
  );
}
