import { useEffect, useRef, useState } from "preact/hooks";

export const ESTIMATE_ROW_HEIGHT = 32;

export const MIN_MEASURED_ROWS_FOR_ESTIMATE = 10;

export const MAX_FLING_OVERSCAN = 150;

export type VirtualItem = { index: number; start: number };

export type VirtualListResult = {
  totalSize: number;
  virtualItems: VirtualItem[];
  measureElement: (el: HTMLElement | null) => void;
  scrollToIndex: (index: number, align?: "start" | "center" | "auto") => void;
};

type ScrollContext = {
  scrollEl: HTMLElement;
  getContainerOffset: () => number;
};

function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    if (node.hasAttribute("data-tree-scroll-container")) return node;
    node = node.parentElement;
  }
  return null;
}

export function useVirtualList(
  containerRef: { current: HTMLElement | null },
  count: number,
  overscan: number,
): VirtualListResult {
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollDelta, setScrollDelta] = useState(0);
  const previousScrollTop = useRef(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const measuredHeights = useRef<Map<number, number>>(new Map());
  const scrollCtxRef = useRef<ScrollContext | null>(null);
  const prevCountRef = useRef(count);

  if (prevCountRef.current !== count) {
    prevCountRef.current = count;
    measuredHeights.current.clear();
  }

  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;

    const scrollEl = findScrollContainer(containerEl);
    if (!scrollEl) return;

    const getContainerOffset = (): number => {
      if (scrollEl === containerEl) return 0;
      return containerEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    };

    scrollCtxRef.current = { scrollEl, getContainerOffset };

    const update = () => {
      const offset = getContainerOffset();
      const nextScrollTop = Math.max(0, scrollEl.scrollTop - offset);

      setScrollDelta(nextScrollTop - previousScrollTop.current);
      previousScrollTop.current = nextScrollTop;
      setScrollTop(nextScrollTop);
      setContainerHeight(scrollEl.clientHeight);
    };

    update();
    const initialUpdate = requestAnimationFrame(update);
    scrollEl.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scrollEl);
    ro.observe(containerEl);

    return () => {
      cancelAnimationFrame(initialUpdate);
      scrollEl.removeEventListener("scroll", update);
      ro.disconnect();
      scrollCtxRef.current = null;
    };
  }, []);

  const estimatedRowHeight = (): number => {
    const measured = measuredHeights.current;

    if (measured.size < MIN_MEASURED_ROWS_FOR_ESTIMATE) {
      return ESTIMATE_ROW_HEIGHT;
    }

    let sum = 0;
    for (const height of measured.values()) {
      sum += height;
    }

    return sum / measured.size;
  };

  const rowHeight = (idx: number, estimate: number): number => measuredHeights.current.get(idx) ?? estimate;

  const getItemOffset = (idx: number, estimate = estimatedRowHeight()): number => {
    let offset = 0;
    for (let i = 0; i < idx; i++) {
      offset += rowHeight(i, estimate);
    }
    return offset;
  };

  const getTotalSize = (): number => {
    const estimate = estimatedRowHeight();
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += rowHeight(i, estimate);
    }
    return total;
  };

  const estimate = estimatedRowHeight();

  const rowsJumpedOver = Math.ceil(Math.abs(scrollDelta) / estimate);
  const flingOverscan = Math.min(MAX_FLING_OVERSCAN, rowsJumpedOver);
  const overscanBefore = scrollDelta < 0 ? overscan + flingOverscan : overscan;
  const overscanAfter = scrollDelta > 0 ? overscan + flingOverscan : overscan;

  let startIdx = 0;
  let startOffset = 0;
  {
    let accumulated = 0;
    for (let i = 0; i < count; i++) {
      const h = rowHeight(i, estimate);
      if (accumulated + h > scrollTop) {
        startIdx = Math.max(0, i - overscanBefore);
        break;
      }
      accumulated += h;
      if (i === count - 1) startIdx = Math.max(0, count - overscanBefore);
    }
    startOffset = getItemOffset(startIdx, estimate);
  }

  let endIdx = count - 1;
  {
    let accumulated = 0;
    let pastStart = false;
    for (let i = 0; i < count; i++) {
      const h = rowHeight(i, estimate);
      if (i >= startIdx) pastStart = true;
      if (pastStart) accumulated += h;
      if (pastStart && accumulated > containerHeight) {
        endIdx = Math.min(count - 1, i + overscanAfter);
        break;
      }
    }
  }

  const virtualItems: VirtualItem[] = [];
  let runningOffset = startOffset;
  for (let i = startIdx; i <= endIdx; i++) {
    virtualItems.push({ index: i, start: runningOffset });
    runningOffset += rowHeight(i, estimate);
  }

  const measureElement = (el: HTMLElement | null) => {
    if (!el) return;
    const idx = parseInt(el.getAttribute("data-index") ?? "", 10);
    if (isNaN(idx)) return;
    const h = el.getBoundingClientRect().height;
    if (h > 0 && measuredHeights.current.get(idx) !== h) {
      measuredHeights.current.set(idx, h);
    }
  };

  const scrollToIndex = (index: number, align: "start" | "center" | "auto" = "auto") => {
    const applyScroll = () => {
      const ctx = scrollCtxRef.current;
      if (!ctx) return;
      const { scrollEl, getContainerOffset } = ctx;
      const containerOffset = getContainerOffset();
      const itemStart = getItemOffset(index) + containerOffset;
      const itemHeight = measuredHeights.current.get(index) ?? ESTIMATE_ROW_HEIGHT;
      if (align === "start") {
        scrollEl.scrollTop = itemStart;
      } else if (align === "center") {
        scrollEl.scrollTop = itemStart - scrollEl.clientHeight / 2 + itemHeight / 2;
      } else {
        if (itemStart < scrollEl.scrollTop) {
          scrollEl.scrollTop = itemStart;
        } else if (itemStart + itemHeight > scrollEl.scrollTop + scrollEl.clientHeight) {
          scrollEl.scrollTop = itemStart + itemHeight - scrollEl.clientHeight;
        }
      }
    };

    applyScroll();
    requestAnimationFrame(applyScroll);
  };

  return { totalSize: getTotalSize(), virtualItems, measureElement, scrollToIndex };
}
