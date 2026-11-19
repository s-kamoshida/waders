/**
 * 画面の最上位のコンポーネント。
 *
 * 所属: クライアント
 * 責務:
 *  - 画面全体の枠（ヘッダー）と、リスト・アーカイブのタブの切り替え（issue #9）
 *  - 開いたときに延期の確認を待っている商品があれば、延期の確認のモーダルを表示する（issue #9）。
 *    「あとで」で閉じた場合は、次に開くまで表示しない。回答したら表示中の一覧を読み込み直す
 *  - ヘッダーの「カテゴリーの管理」でカテゴリーの管理のモーダルを開く。変更して閉じたら、表示中の一覧とカテゴリーを読み込み直す（issue #10）
 */
import { useCallback, useRef, useState } from 'react';
import type { ProductListItem } from '../shared/productContract.ts';
import { CategoryManagerDialog } from './components/CategoryManagerDialog.tsx';
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
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  // 延期の確認は開いたときに一度だけ表示する。関数を変えると一覧を読み込み直すため、状態ではなく ref で覚える
  const hasCheckedDeliveryConfirmationRef = useRef(false);

  const checkDeliveryConfirmation = useCallback((products: readonly ProductListItem[]) => {
    if (hasCheckedDeliveryConfirmationRef.current) return;
    hasCheckedDeliveryConfirmationRef.current = true;
    setAwaitingProducts(products.filter((product) => product.deliveryConfirmationPending));
  }, []);

  /** カテゴリーの管理を閉じる。変更した場合は、表示中の一覧を作り直して商品とカテゴリーを読み込み直す。 */
  const closeCategoryManager = (hasChanged: boolean) => {
    setIsCategoryManagerOpen(false);
    if (hasChanged) setPageReloadCount((count) => count + 1);
  };

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
        <span className="application-header-spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label="カテゴリーの管理"
          title="カテゴリーの管理"
          onClick={() => setIsCategoryManagerOpen(true)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
            <circle cx="7.5" cy="7.5" r="1.5" />
          </svg>
        </button>
      </header>
      <main className="application-main" id="tab-panel" role="tabpanel" aria-labelledby={`tab-${selectedTab}`}>
        {selectedTab === 'list' && (
          <ProductListPage key={pageReloadCount} currentTime={currentTime} onProductsLoaded={checkDeliveryConfirmation} />
        )}
        {selectedTab === 'archive' && <ArchivePage key={pageReloadCount} currentTime={currentTime} />}
      </main>
      {isCategoryManagerOpen && <CategoryManagerDialog onClose={closeCategoryManager} />}
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
