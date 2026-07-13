import type { ReactNode } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import {
  PAGE_TRANSITION_LAYER_CONTEXT_VALUES,
  PageTransitionLayerContext,
} from './PageTransitionLayer';
import './PageTransition.scss';

interface PageTransitionProps {
  render: (location: Location) => ReactNode;
  /** @deprecated Instant routing — kept for call-site compatibility. */
  getRouteOrder?: (pathname: string) => number | null;
  /** @deprecated Instant routing — kept for call-site compatibility. */
  getTransitionVariant?: (fromPathname: string, toPathname: string) => string;
  /** @deprecated Instant routing — kept for call-site compatibility. */
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Instant route swap. No enter/exit layers, no Motion — previous page never
 * stays mounted under the next one (that was the nav flicker).
 */
export function PageTransition({ render }: PageTransitionProps) {
  const location = useLocation();

  return (
    <div className="page-transition">
      <div className="page-transition__layer">
        <PageTransitionLayerContext.Provider value={PAGE_TRANSITION_LAYER_CONTEXT_VALUES.current}>
          {render(location)}
        </PageTransitionLayerContext.Provider>
      </div>
    </div>
  );
}
