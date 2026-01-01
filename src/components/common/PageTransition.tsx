import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import gsap from 'gsap';
import './PageTransition.scss';

interface PageTransitionProps {
  render: (location: Location) => ReactNode;
  getRouteOrder?: (pathname: string) => number | null;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

const TRANSITION_DURATION = 0.65;

type LayerStatus = 'current' | 'exiting';

type Layer = {
  key: string;
  location: Location;
  status: LayerStatus;
};

type TransitionDirection = 'forward' | 'backward';

export function PageTransition({
  render,
  getRouteOrder,
  scrollContainerRef,
}: PageTransitionProps) {
  const location = useLocation();
  const currentLayerRef = useRef<HTMLDivElement>(null);
  const exitingLayerRef = useRef<HTMLDivElement>(null);
  const exitScrollOffsetRef = useRef(0);

  const [isAnimating, setIsAnimating] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<TransitionDirection>('forward');
  const [layers, setLayers] = useState<Layer[]>(() => [
    {
      key: location.key,
      location,
      status: 'current',
    },
  ]);
  const currentLayerKey = layers[layers.length - 1]?.key ?? location.key;
  const currentLayerPathname = layers[layers.length - 1]?.location.pathname;

  const resolveScrollContainer = useCallback(() => {
    if (scrollContainerRef?.current) return scrollContainerRef.current;
    if (typeof document === 'undefined') return null;
    return document.scrollingElement as HTMLElement | null;
  }, [scrollContainerRef]);

  useEffect(() => {
    if (isAnimating) return;
    if (location.key === currentLayerKey) return;
    const scrollContainer = resolveScrollContainer();
    exitScrollOffsetRef.current = scrollContainer?.scrollTop ?? 0;
    const resolveOrderIndex = (pathname?: string) => {
      if (!getRouteOrder || !pathname) return null;
      const index = getRouteOrder(pathname);
      return typeof index === 'number' && index >= 0 ? index : null;
    };
    const fromIndex = resolveOrderIndex(currentLayerPathname);
    const toIndex = resolveOrderIndex(location.pathname);
    const nextDirection: TransitionDirection =
      fromIndex === null || toIndex === null || fromIndex === toIndex
        ? 'forward'
        : toIndex > fromIndex
          ? 'forward'
          : 'backward';
    setTransitionDirection(nextDirection);
    setLayers((prev) => {
      const prevCurrent = prev[prev.length - 1];
      return [
        prevCurrent
          ? { ...prevCurrent, status: 'exiting' }
          : { key: location.key, location, status: 'exiting' },
        { key: location.key, location, status: 'current' },
      ];
    });
    setIsAnimating(true);
  }, [
    isAnimating,
    location,
    currentLayerKey,
    currentLayerPathname,
    getRouteOrder,
    resolveScrollContainer,
  ]);

  // Run GSAP animation when animating starts
  useLayoutEffect(() => {
    if (!isAnimating) return;

    if (!currentLayerRef.current) return;

    const scrollContainer = resolveScrollContainer();
    const scrollOffset = exitScrollOffsetRef.current;
    if (scrollContainer && scrollOffset > 0) {
      scrollContainer.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    const tl = gsap.timeline({
      onComplete: () => {
        setLayers((prev) => prev.filter((layer) => layer.status !== 'exiting'));
        setIsAnimating(false);
      },
    });

    // Exit animation: fly out to top (slow-to-fast)
    if (exitingLayerRef.current) {
      gsap.set(exitingLayerRef.current, { y: scrollOffset ? -scrollOffset : 0 });
      tl.fromTo(
        exitingLayerRef.current,
        { yPercent: 0, opacity: 1 },
        {
          yPercent: transitionDirection === 'forward' ? -100 : 100,
          opacity: 0,
          duration: TRANSITION_DURATION,
          ease: 'power3.in', // slow start, fast end
        },
        0
      );
    }

    // Enter animation: slide in from bottom (slow-to-fast)
    tl.fromTo(
      currentLayerRef.current,
      { yPercent: transitionDirection === 'forward' ? 100 : -100, opacity: 0 },
      {
        yPercent: 0,
        opacity: 1,
        duration: TRANSITION_DURATION,
        ease: 'power2.in', // slow start, fast end
      },
      0
    );

    return () => {
      tl.kill();
      gsap.killTweensOf([currentLayerRef.current, exitingLayerRef.current]);
    };
  }, [isAnimating, transitionDirection, resolveScrollContainer]);

  return (
    <div className={`page-transition${isAnimating ? ' page-transition--animating' : ''}`}>
      {layers.map((layer) => (
        <div
          key={layer.key}
          className={`page-transition__layer${
            layer.status === 'exiting' ? ' page-transition__layer--exit' : ''
          }`}
          ref={layer.status === 'exiting' ? exitingLayerRef : currentLayerRef}
        >
          {render(layer.location)}
        </div>
      ))}
    </div>
  );
}
