import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_GAP_PX = 56;

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
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const [stickToBottom, setStickToBottom] = useState(true);

  const updateStickState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const currentTop = el.scrollTop;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nextStick = shouldStickToBottom({
      distanceFromBottom,
      currentTop,
      lastTop: lastScrollTopRef.current,
    });
    lastScrollTopRef.current = currentTop;
    setStickToBottom(nextStick);
  }, []);

  const jumpToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    anchorRef.current?.scrollIntoView({ block: 'end', behavior });
    const el = scrollRef.current;
    if (el) lastScrollTopRef.current = el.scrollHeight;
    setStickToBottom(true);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;
    const onScroll = () => updateStickState();
    el.addEventListener('scroll', onScroll, { passive: true });
    updateStickState();
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateStickState]);

  useEffect(() => {
    if (!stickToBottom) return;
    anchorRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
  }, [depSignal, stickToBottom]);

  useEffect(() => {
    if (!stickToBottom) return;
    if (typeof ResizeObserver === 'undefined') return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const observer = new ResizeObserver(() => {
      if (!stickToBottom) return;
      anchorRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
    });
    observer.observe(scrollEl);

    return () => observer.disconnect();
  }, [stickToBottom]);

  return { scrollRef, anchorRef, stickToBottom, jumpToLatest };
}
