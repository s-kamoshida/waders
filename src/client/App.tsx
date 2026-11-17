/**
 * 画面の最上位のコンポーネント。
 *
 * 所属: クライアント
 * 責務:
 *  - 画面全体の枠（ヘッダー）と、リスト・アーカイブのタブの切り替え（issue #9）
 *  - 開いたときに延期の確認を待っている商品があれば、延期の確認のモーダルを表示する（issue #9）。
 *    「あとで」で閉じた場合は、次に開くまで表示しない。回答したら表示中の一覧を読み込み直す
 */
import { useCallback, useRef, useState } from 'react';
import type { ProductListItem } from '../shared/productContract.ts';
import { DeliveryConfirmationDialog } from './components/DeliveryConfirmationDialog.tsx';
import { ArchivePage } from './pages/ArchivePage.tsx';
import { ProductListPage } from './pages/ProductListPage.tsx';
import { formatMonthInJapan } from './productDisplay.ts';

/** 表示するタブ。 */
type TabName = 'list' | 'archive';

const TABS: readonly (readonly [TabName, string])[] = [
  ['list', 'リスト'],
  ['archive', 'アーカイブ'],
];

/** App の引数。 */
export type AppProps = {
  /** 現在時刻。省略すると開いた時刻（テストで時刻を固定するため）。 */
  readonly currentTime?: Date;
};

/** 画面全体を描画する。 */
export function App({ currentTime: givenCurrentTime }: AppProps) {
  const [currentTime] = useState(() => givenCurrentTime ?? new Date());
  const [selectedTab, setSelectedTab] = useState<TabName>('list');
  const [pageReloadCount, setPageReloadCount] = useState(0);
  const [awaitingProducts, setAwaitingProducts] = useState<readonly ProductListItem[]>([]);
  // 延期の確認は開いたときに一度だけ表示する。関数を変えると一覧を読み込み直すため、状態ではなく ref で覚える
  const hasCheckedDeliveryConfirmationRef = useRef(false);

  const checkDeliveryConfirmation = useCallback((products: readonly ProductListItem[]) => {
    if (hasCheckedDeliveryConfirmationRef.current) return;
    hasCheckedDeliveryConfirmationRef.current = true;
    setAwaitingProducts(products.filter((product) => product.deliveryConfirmationPending));
  }, []);

  const completeDeliveryConfirmation = () => {
    setAwaitingProducts([]);
    setPageReloadCount((count) => count + 1);
  };

  return (
    <div className="application">
      <header className="application-header">
        <h1 className="application-title">Waders</h1>
        <div className="tabs" role="tablist" aria-label="表示する商品">
          {TABS.map(([tabName, label]) => (
            <button
              key={tabName}
              type="button"
              role="tab"
              id={`tab-${tabName}`}
              aria-controls="tab-panel"
              aria-selected={selectedTab === tabName}
              className={selectedTab === tabName ? 'tab tab--selected' : 'tab'}
              onClick={() => setSelectedTab(tabName)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <main className="application-main" id="tab-panel" role="tabpanel" aria-labelledby={`tab-${selectedTab}`}>
        {selectedTab === 'list' && (
          <ProductListPage key={pageReloadCount} currentTime={currentTime} onProductsLoaded={checkDeliveryConfirmation} />
        )}
        {selectedTab === 'archive' && <ArchivePage key={pageReloadCount} currentTime={currentTime} />}
      </main>
      {awaitingProducts.length > 0 && (
        <DeliveryConfirmationDialog
          products={awaitingProducts}
          currentMonth={formatMonthInJapan(currentTime)}
          onClose={() => setAwaitingProducts([])}
          onCompleted={completeDeliveryConfirmation}
        />
      )}
    </div>
  );
}
