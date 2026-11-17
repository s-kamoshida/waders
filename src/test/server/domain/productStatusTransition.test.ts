import { describe, expect, it } from 'vitest';
import { determineAutomaticTransition, isProductArchived } from '../../../server/domain/productStatusTransition.ts';

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
