import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import './ContentTransition.scss';

type LayerStatus = 'current' | 'exiting';

type Layer = {
  key: string;
  node: ReactNode;
  status: LayerStatus;
};

type TransitionDirection = 'forward' | 'backward';

const TRANSITION_DURATION = 0.22;
const EXIT_DURATION = 0.18;
const ENTER_DELAY = 0.03;

export function ContentTransition({
  transitionKey,
  children,
  getOrder,
  className,
  travel = 36,
}: {
  transitionKey: string;
  children: ReactNode;
  getOrder?: (key: string) => number | null;
  className?: string;
  travel?: number;
}) {
  const currentLayerRef = useRef<HTMLDivElement>(null);
  const exitingLayerRef = useRef<HTMLDivElement>(null);

  const [isAnimating, setIsAnimating] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<TransitionDirection>('forward');
  const [layers, setLayers] = useState<Layer[]>(() => [
    { key: transitionKey, node: children, status: 'current' },
  ]);
  const currentLayerKey = layers[layers.length - 1]?.key ?? transitionKey;

  useEffect(() => {
    if (isAnimating) return;

    if (transitionKey === currentLayerKey) {
      setLayers([{ key: transitionKey, node: children, status: 'current' }]);
      return;
    }

    const resolveOrderIndex = (key: string) => {
      if (!getOrder) return null;
      const index = getOrder(key);
      return typeof index === 'number' && index >= 0 ? index : null;
    };
    const fromIndex = resolveOrderIndex(currentLayerKey);
    const toIndex = resolveOrderIndex(transitionKey);
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
          : { key: transitionKey, node: children, status: 'exiting' },
        { key: transitionKey, node: children, status: 'current' },
      ];
    });
    setIsAnimating(true);
  }, [children, currentLayerKey, getOrder, isAnimating, transitionKey]);

  useLayoutEffect(() => {
    if (!isAnimating) return;
    if (!currentLayerRef.current) return;

    const enterFromX = transitionDirection === 'forward' ? travel : -travel;
    const exitToX = transitionDirection === 'forward' ? -travel : travel;

    const tl = gsap.timeline({
      onComplete: () => {
        setLayers((prev) => prev.filter((layer) => layer.status !== 'exiting'));
        setIsAnimating(false);
      },
    });

    if (exitingLayerRef.current) {
      tl.fromTo(
        exitingLayerRef.current,
        { x: 0, opacity: 1 },
        {
          x: exitToX,
          opacity: 0,
          duration: EXIT_DURATION,
          ease: 'power2.in',
          force3D: true,
        },
        0
      );
    }

    tl.fromTo(
      currentLayerRef.current,
      { x: enterFromX, opacity: 0 },
      {
        x: 0,
        opacity: 1,
        duration: TRANSITION_DURATION,
        ease: 'power2.out',
        clearProps: 'transform,opacity',
        force3D: true,
      },
      ENTER_DELAY
    );

    return () => {
      tl.kill();
      gsap.killTweensOf([currentLayerRef.current, exitingLayerRef.current]);
    };
  }, [isAnimating, travel, transitionDirection]);

  return (
    <div
      className={[
        'content-transition',
        isAnimating ? 'content-transition--animating' : '',
        className || '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {layers.map((layer) => (
        <div
          key={`${layer.key}:${layer.status}`}
          className={`content-transition__layer${
            layer.status === 'exiting' ? ' content-transition__layer--exit' : ''
          }`}
          ref={layer.status === 'exiting' ? exitingLayerRef : currentLayerRef}
        >
          {layer.node}
        </div>
      ))}
    </div>
  );
}

