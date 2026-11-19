/**
 * 商品のドラッグアンドドロップ（リストの月への発売月の移動）。
 *
 * 所属: クライアント（画面の部品）
 * 責務（issue #13）:
 *  - マウスなどの細かく指せる端末: ブラウザ標準のドラッグアンドドロップ（draggable）で掴み、月に落とす
 *  - タッチ操作: カードを 0.4 秒長押しして掴む（その前に 10px 以上動いたらスクロールとして扱う）。
 *    掴んでいる間はページのスクロールを止め、指の下の月を落とす先にする。画面の上端・下端ではページをスクロールする
 *  - 落とす先の月（月の並び・月の見出し。data-drop-month を持つ要素）を返し、同じ月に落とした場合は何もしない
 * 位置を style で動かす表示（指に付いて動くカード）は使わない（CSP の決まり）。
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type HTMLAttributes } from 'react';
import type { ProductResponse } from '../../shared/productContract.ts';

/** 長押しと判定するまでの時間（ミリ秒）。 */
const LONG_PRESS_MILLISECONDS = 400;
/** 長押しの前にこれ以上動いたら、スクロールとして扱う（px）。 */
const MOVE_TOLERANCE_PIXELS = 10;
/** 画面の上端・下端からこの距離に入ったら、ページをスクロールする（px）。 */
const AUTO_SCROLL_EDGE_PIXELS = 80;
/** 自動スクロールの 1 フレームあたりの量（px）。 */
const AUTO_SCROLL_STEP_PIXELS = 12;
/** 掴んだ後の指を離したときのクリックを無視する時間（ミリ秒）。クリックが来なかった場合に、次のタップを無視しないため。 */
const CLICK_SUPPRESSION_MILLISECONDS = 500;

/** 月の要素に付ける、落とす先としての属性と操作。 */
export type MonthDropTargetProps = Pick<HTMLAttributes<HTMLElement>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'> & {
  readonly 'data-drop-month': string;
};

/** カードの要素に付ける操作。 */
export type CardDragHandlers = Pick<
  HTMLAttributes<HTMLElement>,
  'draggable' | 'onDragStart' | 'onDragEnd' | 'onPointerDown' | 'onClickCapture' | 'onContextMenu'
>;

/** useProductDragAndDrop の結果。 */
export type ProductDragAndDrop = {
  /** 落とす先として強調する月（YYYY-MM）。 */
  readonly dropTargetMonth: string | null;
  /** タッチ操作で掴んでいる商品の ID。 */
  readonly grabbedProductId: string | null;
  readonly getCardHandlers: (product: ProductResponse) => CardDragHandlers;
  readonly getMonthDropTargetProps: (month: string) => MonthDropTargetProps;
};

/** マウスなどの細かく指せる端末か（ブラウザ標準のドラッグを使うか）。 */
function canDragWithMouse(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
}

/** 指の下にある月（data-drop-month）を返す。 */
function findMonthAt(clientX: number, clientY: number): string | null {
  if (typeof document.elementFromPoint !== 'function') return null;
  const element = document.elementFromPoint(clientX, clientY);
  return element?.closest('[data-drop-month]')?.getAttribute('data-drop-month') ?? null;
}

/**
 * 商品のドラッグアンドドロップを扱う。
 * @param onMoveProduct 別の月に落としたときに呼ぶ（同じ月なら呼ばない）
 */
export function useProductDragAndDrop(onMoveProduct: (product: ProductResponse, month: string) => void): ProductDragAndDrop {
  const [isMouseDragEnabled] = useState(canDragWithMouse);
  const [dropTargetMonth, setDropTargetMonth] = useState<string | null>(null);
  const [grabbedProductId, setGrabbedProductId] = useState<string | null>(null);
  const draggingProductRef = useRef<ProductResponse | null>(null);
  const dropTargetMonthRef = useRef<string | null>(null);
  const isClickSuppressedRef = useRef(false);
  const stopTouchDragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopTouchDragRef.current?.(), []);

  const updateDropTarget = useCallback((month: string | null) => {
    dropTargetMonthRef.current = month;
    setDropTargetMonth(month);
  }, []);

  /** 掴んでいる商品を月に落とす。月がない・同じ月の場合は何もしない。 */
  const dropOnto = useCallback(
    (month: string | null) => {
      const product = draggingProductRef.current;
      draggingProductRef.current = null;
      updateDropTarget(null);
      if (product === null || month === null || month === product.releaseMonth) return;
      onMoveProduct(product, month);
    },
    [onMoveProduct, updateDropTarget],
  );

  /** タッチ操作の長押しを待ち、掴んだら指の動きに合わせて落とす先を変える。 */
  const startTouchPress = (product: ProductResponse, startX: number, startY: number, pointerId: number) => {
    stopTouchDragRef.current?.();
    let isGrabbed = false;
    let lastX = startX;
    let lastY = startY;
    let scrollStep = 0;
    let animationFrame: number | undefined;

    const scrollNearEdge = () => {
      if (!isGrabbed || scrollStep === 0) {
        animationFrame = undefined;
        return;
      }
      const scroller = document.scrollingElement ?? document.documentElement;
      scroller.scrollTop += scrollStep;
      updateDropTarget(findMonthAt(lastX, lastY));
      animationFrame = requestAnimationFrame(scrollNearEdge);
    };
    const preventScroll = (event: TouchEvent) => {
      if (isGrabbed) event.preventDefault();
    };
    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      lastX = event.clientX;
      lastY = event.clientY;
      if (!isGrabbed) {
        if (Math.hypot(lastX - startX, lastY - startY) > MOVE_TOLERANCE_PIXELS) stop();
        return;
      }
      updateDropTarget(findMonthAt(lastX, lastY));
      scrollStep = lastY < AUTO_SCROLL_EDGE_PIXELS ? -AUTO_SCROLL_STEP_PIXELS : 0;
      if (lastY > window.innerHeight - AUTO_SCROLL_EDGE_PIXELS) scrollStep = AUTO_SCROLL_STEP_PIXELS;
      if (scrollStep !== 0 && animationFrame === undefined && typeof requestAnimationFrame === 'function') {
        animationFrame = requestAnimationFrame(scrollNearEdge);
      }
    };
    const handleUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const wasGrabbed = isGrabbed;
      const month = dropTargetMonthRef.current;
      stop();
      if (!wasGrabbed) return;
      isClickSuppressedRef.current = true;
      setTimeout(() => {
        isClickSuppressedRef.current = false;
      }, CLICK_SUPPRESSION_MILLISECONDS);
      dropOnto(month);
    };
    const handleCancel = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      stop();
      draggingProductRef.current = null;
      updateDropTarget(null);
    };
    const timer = setTimeout(() => {
      isGrabbed = true;
      draggingProductRef.current = product;
      setGrabbedProductId(product.id);
    }, LONG_PRESS_MILLISECONDS);

    function stop() {
      clearTimeout(timer);
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleCancel);
      document.removeEventListener('touchmove', preventScroll);
      isGrabbed = false;
      setGrabbedProductId(null);
      stopTouchDragRef.current = null;
    }

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('pointercancel', handleCancel);
    // 掴んでいる間はページのスクロールを止める（passive: false でないと preventDefault が効かない）
    document.addEventListener('touchmove', preventScroll, { passive: false });
    stopTouchDragRef.current = stop;
  };

  const getCardHandlers = (product: ProductResponse): CardDragHandlers => ({
    draggable: isMouseDragEnabled ? true : undefined,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      draggingProductRef.current = product;
      event.dataTransfer?.setData('text/plain', product.id);
      if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => {
      draggingProductRef.current = null;
      updateDropTarget(null);
    },
    onPointerDown: (event) => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      startTouchPress(product, event.clientX, event.clientY, event.pointerId);
    },
    onClickCapture: (event) => {
      if (!isClickSuppressedRef.current) return;
      isClickSuppressedRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu: (event) => {
      // 長押しで出るメニュー（Android など）を出さない
      if (stopTouchDragRef.current !== null) event.preventDefault();
    },
  });

  const getMonthDropTargetProps = (month: string): MonthDropTargetProps => {
    const acceptDrag = (event: DragEvent<HTMLElement>) => {
      if (draggingProductRef.current === null) return;
      event.preventDefault();
      if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.dropEffect = 'move';
      if (dropTargetMonthRef.current !== month) updateDropTarget(month);
    };
    return {
      'data-drop-month': month,
      onDragEnter: acceptDrag,
      onDragOver: acceptDrag,
      onDragLeave: (event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        if (dropTargetMonthRef.current === month) updateDropTarget(null);
      },
      onDrop: (event) => {
        if (draggingProductRef.current === null) return;
        event.preventDefault();
        dropOnto(month);
      },
    };
  };

  return { dropTargetMonth, grabbedProductId, getCardHandlers, getMonthDropTargetProps };
}
