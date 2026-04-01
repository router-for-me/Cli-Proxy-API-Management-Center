import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface DeferredRenderProps {
  children: ReactNode;
  placeholder?: ReactNode;
  className?: string;
  minHeight?: number | string;
  rootMargin?: string;
  threshold?: number | number[];
}

export function DeferredRender({
  children,
  placeholder = null,
  className,
  minHeight,
  rootMargin = '240px 0px',
  threshold = 0.01,
}: DeferredRenderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(() => {
    if (typeof window === 'undefined') return true;
    return typeof window.IntersectionObserver === 'undefined';
  });

  useEffect(() => {
    if (shouldRender) return;
    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldRender(true);
        observer.disconnect();
      },
      {
        rootMargin,
        threshold,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, shouldRender, threshold]);

  const style: CSSProperties | undefined =
    !shouldRender && minHeight !== undefined ? { minHeight } : undefined;

  return (
    <div ref={containerRef} className={className} style={style}>
      {shouldRender ? children : placeholder}
    </div>
  );
}
