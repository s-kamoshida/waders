import { describe, expect, it } from 'vitest';
import {
  extractShopDomain,
  formatDateInJapan,
  formatEventDuration,
  formatEventPeriod,
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

describe('開催日時と開催期間の表記（PR #30 のレビュー）', () => {
  /** 開催日時（日本時間 2026/11/20 18:00）。 */
  const EVENT_STARTS_AT = '2026-11-20T09:00:00.000Z';

  /** 開催日時から指定した分だけ後の日時（UTC の ISO 8601）。 */
  function minutesAfterStart(minutes: number): string {
    return new Date(Date.parse(EVENT_STARTS_AT) + minutes * 60_000).toISOString();
  }

  describe('開催日時と終了日時（カードを並べる幅）', () => {
    it('終了が開催と同じ日（日本時間）の場合、「11/20 18:00〜21:00」のように終了の日付を省く', () => {
      expect(formatEventPeriod(EVENT_STARTS_AT, '2026-11-20T12:00:00.000Z')).toBe('11/20 18:00〜21:00');
    });

    it('終了が別の日の場合、終了の日付も示す（日付は日本時間で決める）', () => {
      expect(formatEventPeriod(EVENT_STARTS_AT, '2026-11-20T15:30:00.000Z')).toBe('11/20 18:00〜11/21 0:30');
      expect(formatEventPeriod('2026-11-30T23:00:00.000Z', '2026-12-02T09:05:00.000Z')).toBe('12/1 8:00〜12/2 18:05');
    });

    it('年が変わる場合、年も示す', () => {
      expect(formatEventPeriod('2026-12-31T13:00:00.000Z', '2026-12-31T17:00:00.000Z')).toBe('2026/12/31 22:00〜2027/1/1 2:00');
    });
  });

  describe('開催期間（スマートフォンの幅のリスト形式）', () => {
    it.each([
      [0, '約0.5時間'],
      [10, '約0.5時間'],
      [29, '約0.5時間'],
      [30, '約0.5時間'],
      [44, '約0.5時間'],
      [45, '約1時間'],
      [60, '約1時間'],
      [90, '約1.5時間'],
      [104, '約1.5時間'],
      [105, '約2時間'],
      [180, '約3時間'],
      [23 * 60 + 14, '約23時間'],
      [23 * 60 + 15, '約23.5時間'],
      [23 * 60 + 44, '約23.5時間'],
    ])('%i 分の場合、「%s」と示す（時間の単位で 0.5 刻みに四捨五入）', (minutes, expected) => {
      expect(formatEventDuration(EVENT_STARTS_AT, minutesAfterStart(minutes))).toBe(expected);
    });

    it.each([
      [23 * 60 + 45, '約1日'],
      [23 * 60 + 50, '約1日'],
      [24 * 60, '約1日'],
      [29 * 60 + 59, '約1日'],
      [30 * 60, '約1.5日'],
      [36 * 60, '約1.5日'],
      [41 * 60 + 59, '約1.5日'],
      [42 * 60, '約2日'],
      [54 * 60, '約2.5日'],
      [10 * 24 * 60, '約10日'],
    ])('%i 分の場合、「%s」と示す（時間で四捨五入して 24 時間以上なら日の単位で 0.5 刻みに四捨五入）', (minutes, expected) => {
      expect(formatEventDuration(EVENT_STARTS_AT, minutesAfterStart(minutes))).toBe(expected);
    });
  });
});
