/**
 * モーダルの閉じるボタン（×）を探す、画面テスト用の補助（テスト専用。issue #49）。
 * 見出しの行に置く「閉じる」ボタンと、フッターの保存せずに閉じるボタンを区別して取り出す。
 */
import { within } from '@testing-library/react';
import { expect, type Mock } from 'vitest';

/**
 * モーダルの見出しの行にある「閉じる」ボタン（×）を返す。
 * 見出し（h2）と同じ行（見出しの親の要素）にあり、その行にはほかのボタンがないこと
 * （フッターや本文のボタンと同じ入れ物ではないこと）を確かめる。
 * @param dialog モーダル（role="dialog" の要素）
 * @returns 見出しの行の「閉じる」ボタン
 */
export function getHeaderCloseButton(dialog: HTMLElement): HTMLElement {
  const heading = within(dialog).getAllByRole('heading', { level: 2 })[0];
  expect(heading, 'モーダルに見出し（h2）がない').toBeDefined();
  const headerRow = heading?.parentElement;
  expect(headerRow, '見出しの行（見出しの親の要素）がない').toBeInstanceOf(HTMLElement);
  if (!(headerRow instanceof HTMLElement)) throw new Error('見出しの行がない');
  const closeButtons = within(headerRow).queryAllByRole('button', { name: '閉じる' });
  expect(closeButtons, '見出しの行に「閉じる」ボタンがない').toHaveLength(1);
  expect(
    within(headerRow).queryAllByRole('button'),
    '見出しの行に「閉じる」以外のボタンがある（見出しの行が、本文やフッターと同じ入れ物になっている）',
  ).toHaveLength(1);
  const [closeButton] = closeButtons;
  if (closeButton === undefined) throw new Error('見出しの行に「閉じる」ボタンがない');
  return closeButton;
}

/**
 * フッターにある、指定した名前のボタンを返す（見出しの行の「閉じる」ボタンと同じ名前のボタンを区別するため）。
 * フッターは本文の後ろにあるため、同じ名前のボタンのうち、DOM で最後のものを返す。
 * @param dialog モーダル（role="dialog" の要素）
 * @param name ボタンの名前（例: 「閉じる」）
 */
export function getFooterButton(dialog: HTMLElement, name: string): HTMLElement {
  const buttons = within(dialog).getAllByRole('button', { name });
  const lastButton = buttons.at(-1);
  if (lastButton === undefined) throw new Error(`「${name}」ボタンがない`);
  return lastButton;
}

/**
 * stubFetchRoutes の fetch のうち、指定したルートだけ応答を返さないままにする（保存中の状態を作るため）。
 * ほかのルートは今までどおりスタブの応答を返す。
 * @param fetchMock stubFetchRoutes が返した fetch のモック
 * @param routeKey `POST /api/products` の形式のルート
 */
export function holdFetchRoute(fetchMock: Mock, routeKey: string): void {
  const respond = fetchMock.getMockImplementation();
  fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
    if (`${init?.method ?? 'GET'} ${String(input)}` === routeKey) return new Promise<Response>(() => {});
    return respond?.(input, init);
  });
}
