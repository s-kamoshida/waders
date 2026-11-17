import { describe, expect, it } from 'vitest';
import {
  extractShopDomain,
  formatDateInJapan,
  formatMonthInJapan,
  formatPriceLabel,
  formatShippingLabel,
  getStatusLabel,
  isOrderDeadlineApproaching,
} from '../../client/productDisplay.ts';

describe('金額と送料の表記', () => {
  it('金額は 3 桁区切りに「円」を付ける', () => {
    expect(formatPriceLabel(19800)).toBe('19,800円');
    expect(formatPriceLabel(0)).toBe('0円');
  });

  it('金額が未入力の場合、「金額未入力」と表記する', () => {
    expect(formatPriceLabel(null)).toBe('金額未入力');
  });

  it('送料がある場合、「送料 800円」と表記する', () => {
    expect(formatShippingLabel(800)).toBe('送料 800円');
  });

  it.each([null, 0])('送料が未入力または 0 円（%s）の場合、「送料無料」と表記する', (shippingFee) => {
    expect(formatShippingLabel(shippingFee)).toBe('送料無料');
  });
});

describe('購入先', () => {
  it('URL のドメインを購入先の名前として返す', () => {
    expect(extractShopDomain('https://www.example.com/item/123')).toBe('www.example.com');
  });

  it('URL が未入力の場合、null を返す', () => {
    expect(extractShopDomain(null)).toBeNull();
  });
});

describe('ステータスの表記', () => {
  it.each([
    ['considering', false, '検討中'],
    ['reserved', false, '予約済'],
    ['reserved', true, '予約済（キャンセル可）'],
    ['purchased', true, '購入済'],
    ['unpurchased', false, '未購入'],
  ] as const)('%s（キャンセル可否: %s）の場合、「%s」と表記する', (status, cancelable, label) => {
    expect(getStatusLabel(status, cancelable)).toBe(label);
  });
});

describe('受注期限の警告（⚠️）', () => {
  const today = '2026-11-17';

  it.each([
    ['当日', '2026-11-17'],
    ['3 日後', '2026-11-20'],
    ['7 日後', '2026-11-24'],
  ])('検討中で受注期限が%sの場合、警告する', (_label, orderDeadline) => {
    expect(isOrderDeadlineApproaching({ status: 'considering', orderDeadline }, today)).toBe(true);
  });

  it('検討中で受注期限が 8 日後の場合、警告しない', () => {
    expect(isOrderDeadlineApproaching({ status: 'considering', orderDeadline: '2026-11-25' }, today)).toBe(false);
  });

  it('受注期限を過ぎている場合、警告しない', () => {
    expect(isOrderDeadlineApproaching({ status: 'considering', orderDeadline: '2026-11-16' }, today)).toBe(false);
  });

  it('受注期限が未入力の場合、警告しない', () => {
    expect(isOrderDeadlineApproaching({ status: 'considering', orderDeadline: null }, today)).toBe(false);
  });

  it.each(['reserved', 'purchased', 'unpurchased'] as const)('検討中以外（%s）の場合、受注期限が近くても警告しない', (status) => {
    expect(isOrderDeadlineApproaching({ status, orderDeadline: '2026-11-18' }, today)).toBe(false);
  });

  it('月をまたぐ場合も日数で判定する', () => {
    expect(isOrderDeadlineApproaching({ status: 'considering', orderDeadline: '2026-12-01' }, '2026-11-24')).toBe(true);
  });
});

describe('日本時間の日付と月', () => {
  it('UTC では前日でも、日本時間の日付を返す', () => {
    const now = new Date('2026-11-30T15:30:00.000Z'); // 日本時間 2026-12-01 00:30

    expect(formatDateInJapan(now)).toBe('2026-12-01');
    expect(formatMonthInJapan(now)).toBe('2026-12');
  });
});
