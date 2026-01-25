import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import gsap from 'gsap';
import './PageTransition.scss';

interface PageTransitionProps {
  render: (location: Location) => ReactNode;
  getRouteOrder?: (pathname: string) => number | null;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

const TRANSITION_DURATION = 0.35;
const TRAVEL_DISTANCE = 60;

type LayerStatus = 'current' | 'exiting';

type Layer = {
  key: string;
  location: Location;
  status: LayerStatus;
};

type TransitionDirection = 'forward' | 'backward';

export function PageTransition({ render, getRouteOrder, scrollContainerRef }: PageTransitionProps) {
  const location = useLocation();
  const currentLayerRef = useRef<HTMLDivElement>(null);
  const exitingLayerRef = useRef<HTMLDivElement>(null);
  const transitionDirectionRef = useRef<TransitionDirection>('forward');
  const exitScrollOffsetRef = useRef(0);

  const [isAnimating, setIsAnimating] = useState(false);
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

    transitionDirectionRef.current = nextDirection;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
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

    const currentLayerEl = currentLayerRef.current;
    const exitingLayerEl = exitingLayerRef.current;

    const scrollContainer = resolveScrollContainer();
    const scrollOffset = exitScrollOffsetRef.current;
    if (scrollContainer && scrollOffset > 0) {
      scrollContainer.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    const transitionDirection = transitionDirectionRef.current;
    const enterFromY = transitionDirection === 'forward' ? TRAVEL_DISTANCE : -TRAVEL_DISTANCE;
    const exitToY = transitionDirection === 'forward' ? -TRAVEL_DISTANCE : TRAVEL_DISTANCE;
    const exitBaseY = scrollOffset ? -scrollOffset : 0;

    const tl = gsap.timeline({
      onComplete: () => {
        setLayers((prev) => prev.filter((layer) => layer.status !== 'exiting'));
        setIsAnimating(false);
      },
    });

    // Exit animation: fade out with slight movement (runs simultaneously)
    if (exitingLayerEl) {
      gsap.set(exitingLayerEl, { y: exitBaseY });
      tl.to(
        exitingLayerEl,
        {
          y: exitBaseY + exitToY,
          opacity: 0,
          duration: TRANSITION_DURATION,
          ease: 'circ.out',
          force3D: true,
        },
        0
      );
    }

    // Enter animation: fade in with slight movement (runs simultaneously)
    tl.fromTo(
      currentLayerEl,
      { y: enterFromY, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: TRANSITION_DURATION,
        ease: 'circ.out',
        force3D: true,
        onComplete: () => {
          if (currentLayerEl) {
            gsap.set(currentLayerEl, { clearProps: 'transform,opacity' });
          }
        },
      },
      0
    );

    return () => {
      tl.kill();
      gsap.killTweensOf([currentLayerEl, exitingLayerEl]);
    };
  }, [isAnimating, resolveScrollContainer]);

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
