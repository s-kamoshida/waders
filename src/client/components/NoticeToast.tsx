/**
 * 画面の下端の知らせ（トースト）。
 *
 * 所属: クライアント（画面の部品）
 * 責務（issue #13）:
 *  - 知らせを画面の下端の中央に重ねて表示し、8 秒で消す（出るとき・消えるときは 0.2 秒で薄くなる・濃くなる）
 *  - 知らせは 1 つだけ。新しい知らせを渡すと置き換え、そこから 8 秒数え直す
 *  - 成功は role="status"、失敗は role="alert"。ボタン（「元に戻す」など）を 1 つ付けられる
 */
import { useEffect, useState } from 'react';

/** 知らせを表示する時間（ミリ秒）。 */
export const NOTICE_DISPLAY_MILLISECONDS = 8000;
/** 消える前に薄くなり始めるまでの時間（ミリ秒）。CSS の transition（0.2 秒）と合わせる。 */
const NOTICE_FADE_MILLISECONDS = 200;

/** 表示する知らせ。新しいオブジェクトを渡すたびに、新しい知らせとして 8 秒数え直す。 */
export type Notice = {
  readonly kind: 'success' | 'error';
  readonly message: string;
  /** 知らせに付けるボタン（「元に戻す」など）。 */
  readonly action?: { readonly label: string; readonly onPress: () => void };
};

/** NoticeToast の引数。 */
export type NoticeToastProps = {
  readonly notice: Notice | null;
  /** 表示の時間が過ぎたときに呼ぶ。 */
  readonly onExpire: (notice: Notice) => void;
};

/** 知らせを描画する。 */
export function NoticeToast({ notice, onExpire }: NoticeToastProps) {
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (notice === null) return;
    setIsLeaving(false);
    const fadeTimer = setTimeout(() => setIsLeaving(true), NOTICE_DISPLAY_MILLISECONDS - NOTICE_FADE_MILLISECONDS);
    const expireTimer = setTimeout(() => onExpire(notice), NOTICE_DISPLAY_MILLISECONDS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(expireTimer);
    };
  }, [notice, onExpire]);

  if (notice === null) return null;
  const classNames = ['notice-toast', notice.kind === 'error' ? 'notice-toast--error' : '', isLeaving ? 'notice-toast--leaving' : '']
    .filter((className) => className !== '')
    .join(' ');
  return (
    <div className="notice-toast-area">
      <div className={classNames} role={notice.kind === 'error' ? 'alert' : 'status'}>
        <span className="notice-toast-message">{notice.message}</span>
        {notice.action !== undefined && (
          <button type="button" className="notice-toast-action" onClick={notice.action.onPress}>
            {notice.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
