/**
 * 画面の最上位のコンポーネント。
 *
 * 所属: クライアント
 * 責務:
 *  - 画面全体の枠（ヘッダー）と、リスト・アーカイブのタブの切り替え（issue #9）
 *  - 開いたときに延期の確認を待っている商品があれば、延期の確認のモーダルを表示する（issue #9）。
 *    「あとで」で閉じた場合は、次に開くまで表示しない。回答したら表示中の一覧を読み込み直す
 *  - ヘッダーの「カテゴリーの管理」でカテゴリーの管理のモーダルを開く。変更して閉じたら、表示中の一覧とカテゴリーを読み込み直す（issue #10）
 *  - 開いたときに認証の状態を確かめ、ログインが必要ならログインの画面（アカウントがなければ作成の画面）を表示する。
 *    確かめるまでは一覧を表示せず、商品を読み込まない。使っている間に API がログインを求めたら、ログインの画面に戻す（issue #11）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductListItem } from '../shared/productContract.ts';
import { CategoryManagerDialog } from './components/CategoryManagerDialog.tsx';
import { DeliveryConfirmationDialog } from './components/DeliveryConfirmationDialog.tsx';
import { ArchivePage } from './pages/ArchivePage.tsx';
import { AuthenticationPage } from './pages/AuthenticationPage.tsx';
import { ProductListPage } from './pages/ProductListPage.tsx';
import { fetchAuthenticationStatus, listenAuthenticationRequired, logOut } from './productApiClient.ts';
import { formatMonthInJapan } from './productDisplay.ts';
import { SCREEN_MESSAGES } from './screenMessages.ts';

/** 表示するタブ。 */
type TabName = 'list' | 'archive';

const TABS: readonly (readonly [TabName, string])[] = [
  ['list', 'リスト'],
  ['archive', 'アーカイブ'],
];

/**
 * 認証の状態に応じた画面。checking は確認中、failed は状態を取得できなかった場合、
 * setup・login はアカウントの作成・ログインの画面、ready は一覧を使える状態（authenticationEnabled はログアウトを表示するか）。
 */
type AuthenticationView =
  | { readonly kind: 'checking' | 'failed' | 'setup' | 'login' }
  | { readonly kind: 'ready'; readonly authenticationEnabled: boolean };

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
  const [authenticationView, setAuthenticationView] = useState<AuthenticationView>({ kind: 'checking' });
  const [isLogoutFailed, setIsLogoutFailed] = useState(false);
  // 延期の確認は開いたときに一度だけ表示する。関数を変えると一覧を読み込み直すため、状態ではなく ref で覚える
  const hasCheckedDeliveryConfirmationRef = useRef(false);

  const checkDeliveryConfirmation = useCallback((products: readonly ProductListItem[]) => {
    if (hasCheckedDeliveryConfirmationRef.current) return;
    hasCheckedDeliveryConfirmationRef.current = true;
    setAwaitingProducts(products.filter((product) => product.deliveryConfirmationPending));
  }, []);

  /** ログインの画面に戻す。開いているモーダルは閉じる。 */
  const showLoginPage = useCallback(() => {
    setIsCategoryManagerOpen(false);
    setAwaitingProducts([]);
    setAuthenticationView({ kind: 'login' });
  }, []);

  useEffect(() => {
    let isCancelled = false;
    fetchAuthenticationStatus()
      .then((status) => {
        if (isCancelled) return;
        if (!status.authenticationEnabled) setAuthenticationView({ kind: 'ready', authenticationEnabled: false });
        else if (!status.accountExists) setAuthenticationView({ kind: 'setup' });
        else setAuthenticationView(status.loggedIn ? { kind: 'ready', authenticationEnabled: true } : { kind: 'login' });
      })
      .catch(() => {
        if (!isCancelled) setAuthenticationView({ kind: 'failed' });
      });
    const stopListening = listenAuthenticationRequired(showLoginPage);
    return () => {
      isCancelled = true;
      stopListening();
    };
  }, [showLoginPage]);

  /** ログアウトして、ログインの画面に戻す。 */
  const logOutAndShowLoginPage = async () => {
    try {
      await logOut();
      setIsLogoutFailed(false);
      showLoginPage();
    } catch {
      setIsLogoutFailed(true);
    }
  };

  /** カテゴリーの管理を閉じる。変更した場合は、表示中の一覧を作り直して商品とカテゴリーを読み込み直す。 */
  const closeCategoryManager = (hasChanged: boolean) => {
    setIsCategoryManagerOpen(false);
    if (hasChanged) setPageReloadCount((count) => count + 1);
  };

  const completeDeliveryConfirmation = () => {
    setAwaitingProducts([]);
    setPageReloadCount((count) => count + 1);
  };

  const isReady = authenticationView.kind === 'ready';

  return (
    <div className="application">
      <header className="application-header">
        <h1 className="application-title">Waders</h1>
        {isReady && (
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
        )}
        <span className="application-header-spacer" />
        {isReady && (
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
        )}
        {isReady && authenticationView.authenticationEnabled && (
          <button type="button" className="button header-button" title="ログアウト" onClick={() => void logOutAndShowLoginPage()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            <span className="header-button-label">ログアウト</span>
          </button>
        )}
      </header>
      {authenticationView.kind === 'failed' && (
        <main className="application-main">
          <p role="alert" className="dialog-error application-message">
            {SCREEN_MESSAGES.authenticationStatusLoadFailed}
          </p>
        </main>
      )}
      {(authenticationView.kind === 'setup' || authenticationView.kind === 'login') && (
        <main className="application-main">
          <AuthenticationPage
            key={authenticationView.kind}
            mode={authenticationView.kind}
            onAuthenticated={() => setAuthenticationView({ kind: 'ready', authenticationEnabled: true })}
          />
        </main>
      )}
      {isReady && (
        <main className="application-main" id="tab-panel" role="tabpanel" aria-labelledby={`tab-${selectedTab}`}>
          {isLogoutFailed && (
            <p role="alert" className="dialog-error application-message">
              {SCREEN_MESSAGES.logoutFailed}
            </p>
          )}
          {selectedTab === 'list' && (
            <ProductListPage key={pageReloadCount} currentTime={currentTime} onProductsLoaded={checkDeliveryConfirmation} />
          )}
          {selectedTab === 'archive' && <ArchivePage key={pageReloadCount} currentTime={currentTime} />}
        </main>
      )}
      {isReady && isCategoryManagerOpen && <CategoryManagerDialog onClose={closeCategoryManager} />}
      {isReady && awaitingProducts.length > 0 && (
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
