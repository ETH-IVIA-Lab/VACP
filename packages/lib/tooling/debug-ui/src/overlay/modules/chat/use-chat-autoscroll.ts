import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_GAP_PX = 56;

export function scrollTopForBottom(args: { scrollHeight: number; clientHeight: number }): number {
  return Math.max(0, args.scrollHeight - args.clientHeight);
}

export function shouldStickToBottom(args: {
  distanceFromBottom: number;
  currentTop: number;
  lastTop: number;
}): boolean {
  if (args.currentTop < args.lastTop && args.distanceFromBottom > 0) return false;
  return args.distanceFromBottom <= BOTTOM_GAP_PX;
}

export function useChatAutoscroll(depSignal: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const [stickToBottom, setStickToBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    const top = scrollTopForBottom({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
    el.scrollTo({ top, behavior });
    lastScrollTopRef.current = top;
  }, []);

  const updateStickState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const currentTop = el.scrollTop;
    const distanceFromBottom = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
    const nextStick = shouldStickToBottom({
      distanceFromBottom,
      currentTop,
      lastTop: lastScrollTopRef.current,
    });
    lastScrollTopRef.current = currentTop;
    setStickToBottom((current) => (current === nextStick ? current : nextStick));
  }, []);

  const jumpToLatest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      scrollToBottom(behavior);
      setStickToBottom((current) => (current ? current : true));
    },
    [scrollToBottom],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;
    const onScroll = () => updateStickState();
    el.addEventListener('scroll', onScroll, { passive: true });
    scrollToBottom('auto');
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollToBottom, updateStickState]);

  useEffect(() => {
    if (!stickToBottom) return;
    scrollToBottom('auto');
  }, [depSignal, scrollToBottom, stickToBottom]);

  useEffect(() => {
    if (!stickToBottom) return;
    if (typeof ResizeObserver === 'undefined') return;
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    const observer = new ResizeObserver(() => {
      if (!stickToBottom) return;
      scrollToBottom('auto');
    });
    observer.observe(scrollEl);
    observer.observe(contentEl);

    return () => observer.disconnect();
  }, [scrollToBottom, stickToBottom]);

  return { scrollRef, contentRef, stickToBottom, jumpToLatest };
}
