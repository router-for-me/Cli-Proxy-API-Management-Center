import { useEffect, useRef, useState } from 'react';

/** Tracks an element's content width so SVG charts can draw in real pixels. */
export function useElementWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth || fallback);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((items) => {
      const next = Math.round(items[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}
