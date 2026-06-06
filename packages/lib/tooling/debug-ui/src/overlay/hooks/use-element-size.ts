import type { RefObject } from 'react';
import { useLayoutEffect, useState } from 'react';

export type ElementSize = { width: number; height: number };

export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const read = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.max(0, Math.round(el.offsetWidth || rect.width));
      const height = Math.max(0, Math.round(el.offsetHeight || rect.height));
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    read();

    const ro = new ResizeObserver(() => read());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}
