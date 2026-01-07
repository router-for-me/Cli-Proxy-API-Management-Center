import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import gsap from 'gsap';
import './PageTransition.scss';

interface PageTransitionProps {
  render: (location: Location) => ReactNode;
  getRouteOrder?: (pathname: string) => number | null;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

const TRANSITION_DURATION = 0.5;
const EXIT_DURATION = 0.45;
const ENTER_DELAY = 0.08;

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
    if (currentLayerPathname === location.pathname) return;
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

    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
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
    });

    return () => {
      cancelled = true;
    };
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

    const containerHeight = scrollContainer?.clientHeight ?? 0;
    const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
    const travelDistance = Math.max(containerHeight, viewportHeight, 1);
    const enterFromY = transitionDirection === 'forward' ? travelDistance : -travelDistance;
    const exitToY = transitionDirection === 'forward' ? -travelDistance : travelDistance;
    const exitBaseY = scrollOffset ? -scrollOffset : 0;

    const tl = gsap.timeline({
      onComplete: () => {
        setLayers((prev) => prev.filter((layer) => layer.status !== 'exiting'));
        setIsAnimating(false);
      },
    });

    // Exit animation: fly out to top (slow-to-fast)
    if (exitingLayerRef.current) {
      gsap.set(exitingLayerRef.current, { y: exitBaseY });
      tl.fromTo(
        exitingLayerRef.current,
        { y: exitBaseY, opacity: 1 },
        {
          y: exitBaseY + exitToY,
          opacity: 0,
          duration: EXIT_DURATION,
          ease: 'power2.in', // fast finish to clear screen
          force3D: true,
        },
        0
      );
    }

    // Enter animation: slide in from bottom (slow-to-fast)
    tl.fromTo(
      currentLayerRef.current,
      { y: enterFromY, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: TRANSITION_DURATION,
        ease: 'power2.out', // smooth settle
        clearProps: 'transform,opacity',
        force3D: true,
      },
      ENTER_DELAY
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
