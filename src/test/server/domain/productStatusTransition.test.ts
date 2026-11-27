import { describe, expect, it } from 'vitest';
import { determineAutomaticTransition, isProductArchived } from '../../../server/domain/productStatusTransition.ts';
import type { ProductStatus } from '../../../shared/productContract.ts';

/** キャンセル（issue #57）。実装の前でも型チェックを通すため、文字列から変換して使う。 */
const CANCELED_STATUS = 'canceled' as string as ProductStatus;

/** 日本時間の日時を UTC の Date にする（例: '2026-12-01T00:00' → 2026-11-30T15:00Z）。 */
function japanTime(localDateTime: string): Date {
  return new Date(`${localDateTime}:00+09:00`);
}

describe('予約済の自動遷移', () => {
  it('発売月を超過した（翌月 1 日 0:00 になった）場合、購入済にし、延期の確認を待つ', () => {
    const transition = determineAutomaticTransition(
      { status: 'reserved', releaseMonth: '2026-11', orderDeadline: null },
      japanTime('2026-12-01T00:00'),
    );

    expect(transition).toEqual({ status: 'purchased', awaitsDeliveryConfirmation: true });
  });

  it('発売月の末日 23:59 の場合、変えない', () => {
    expect(
      determineAutomaticTransition({ status: 'reserved', releaseMonth: '2026-11', orderDeadline: null }, japanTime('2026-11-30T23:59')),
    ).toBeNull();
  });

  it('UTC ではまだ前月でも、日本時間で翌月になっていれば超過とする', () => {
    const currentTime = new Date('2026-11-30T15:00:00.000Z'); // 日本時間 2026-12-01 00:00

    expect(
      determineAutomaticTransition({ status: 'reserved', releaseMonth: '2026-11', orderDeadline: null }, currentTime)?.status,
    ).toBe('purchased');
  });

  it('受注期限を超過していても、発売月を超過するまでは予約済のまま', () => {
    expect(
      determineAutomaticTransition(
        { status: 'reserved', releaseMonth: '2026-12', orderDeadline: '2026-11-10' },
        japanTime('2026-11-17T12:00'),
      ),
    ).toBeNull();
  });
});

describe('検討中の自動遷移', () => {
  it('受注期限の翌日 0:00 になった場合、未購入にし、延期の確認は待たない', () => {
    const transition = determineAutomaticTransition(
      { status: 'considering', releaseMonth: '2027-01', orderDeadline: '2026-11-20' },
      japanTime('2026-11-21T00:00'),
    );

    expect(transition).toEqual({ status: 'unpurchased', awaitsDeliveryConfirmation: false });
  });

  it('受注期限の当日 23:59 の場合、変えない', () => {
    expect(
      determineAutomaticTransition(
        { status: 'considering', releaseMonth: '2027-01', orderDeadline: '2026-11-20' },
        japanTime('2026-11-20T23:59'),
      ),
    ).toBeNull();
  });

  it('受注期限がなく、発売月を超過した場合、未購入にする', () => {
    expect(
      determineAutomaticTransition({ status: 'considering', releaseMonth: '2026-11', orderDeadline: null }, japanTime('2026-12-01T00:00')),
    ).toEqual({ status: 'unpurchased', awaitsDeliveryConfirmation: false });
  });

  it('受注期限がまだ先でも、発売月を超過した場合、未購入にする', () => {
    expect(
      determineAutomaticTransition(
        { status: 'considering', releaseMonth: '2026-11', orderDeadline: '2026-12-20' },
        japanTime('2026-12-01T00:00'),
      )?.status,
    ).toBe('unpurchased');
  });

  it('受注期限も発売月も超過していない場合、変えない', () => {
    expect(
      determineAutomaticTransition(
        { status: 'considering', releaseMonth: '2026-12', orderDeadline: '2026-11-20' },
        japanTime('2026-11-17T12:00'),
      ),
    ).toBeNull();
  });
});

describe('購入済・未購入', () => {
  it.each(['purchased', 'unpurchased'] as const)('%s は、発売月や受注期限を超過しても変えない', (status) => {
    expect(
      determineAutomaticTransition({ status, releaseMonth: '2026-10', orderDeadline: '2026-09-30' }, japanTime('2026-12-01T00:00')),
    ).toBeNull();
  });
});

describe('アーカイブの判定', () => {
  it('発売月が当月（日本時間）より前の場合、アーカイブとする', () => {
    expect(isProductArchived({ releaseMonth: '2026-11' }, japanTime('2026-12-01T00:00'))).toBe(true);
  });

  it('発売月が当月以降の場合、アーカイブとしない', () => {
    expect(isProductArchived({ releaseMonth: '2026-11' }, japanTime('2026-11-30T23:59'))).toBe(false);
    expect(isProductArchived({ releaseMonth: '2027-01' }, japanTime('2026-11-17T12:00'))).toBe(false);
  });
});

describe('キャンセル（issue #57、BR-38）', () => {
  /** 判定に使う商品の値（ステータス・発売月・受注期限）。 */
  type JudgedProduct = { readonly status: ProductStatus; readonly releaseMonth: string; readonly orderDeadline: string | null };

  it.each([
    ['発売月を超過した', '2026-10', null],
    ['受注期限を超過した', '2027-01', '2026-11-10'],
  ])('キャンセルの商品は、%s場合も自動では変えない（自動遷移の対象外）', (_label, releaseMonth, orderDeadline) => {
    const product: JudgedProduct = { status: CANCELED_STATUS, releaseMonth, orderDeadline };

    expect(determineAutomaticTransition(product, japanTime('2026-11-17T12:00'))).toBeNull();
  });

  it.each(['2026-11', '2026-12', '2027-06'])('キャンセルの商品は、発売月が当月以降（%s）でもアーカイブとする', (releaseMonth) => {
    const product: JudgedProduct = { status: CANCELED_STATUS, releaseMonth, orderDeadline: null };

    expect(isProductArchived(product, japanTime('2026-11-17T12:00'))).toBe(true);
  });

  it('キャンセルの商品は、発売月が当月より前の場合もアーカイブとする', () => {
    const product: JudgedProduct = { status: CANCELED_STATUS, releaseMonth: '2026-10', orderDeadline: null };

    expect(isProductArchived(product, japanTime('2026-11-17T12:00'))).toBe(true);
  });

  it.each(['considering', 'reserved', 'purchased', 'unpurchased'] as const)(
    'キャンセル以外（%s）の商品は、今までどおり発売月が当月以降ならアーカイブとしない',
    (status) => {
      const product: JudgedProduct = { status, releaseMonth: '2026-11', orderDeadline: null };

      expect(isProductArchived(product, japanTime('2026-11-17T12:00'))).toBe(false);
    },
  );
});
