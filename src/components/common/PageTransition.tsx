import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import gsap from 'gsap';
import './PageTransition.scss';

interface PageTransitionProps {
  render: (location: Location) => ReactNode;
  getRouteOrder?: (pathname: string) => number | null;
}

const TRANSITION_DURATION = 0.65;

type LayerStatus = 'current' | 'exiting';

type Layer = {
  key: string;
  location: Location;
  status: LayerStatus;
};

type TransitionDirection = 'forward' | 'backward';

export function PageTransition({ render, getRouteOrder }: PageTransitionProps) {
  const location = useLocation();
  const currentLayerRef = useRef<HTMLDivElement>(null);
  const exitingLayerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (isAnimating) return;
    if (location.key === currentLayerKey) return;
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
  ]);

  // Run GSAP animation when animating starts
  useLayoutEffect(() => {
    if (!isAnimating) return;

    if (!currentLayerRef.current) return;

    const tl = gsap.timeline({
      onComplete: () => {
        setLayers((prev) => prev.filter((layer) => layer.status !== 'exiting'));
        setIsAnimating(false);
      },
    });

    // Exit animation: fly out to top (slow-to-fast)
    if (exitingLayerRef.current) {
      tl.fromTo(
        exitingLayerRef.current,
        { y: 0, opacity: 1 },
        {
          y: transitionDirection === 'forward' ? '-100%' : '100%',
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
      { y: transitionDirection === 'forward' ? '100%' : '-100%', opacity: 0 },
      {
        y: 0,
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
  }, [isAnimating, transitionDirection]);

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
