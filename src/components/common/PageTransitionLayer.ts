import { createContext, useContext } from 'react';

export type LayerStatus = 'current' | 'exiting' | 'stacked';

export type PageTransitionLayerContextValue = {
  status: LayerStatus;
  isCurrentLayer: boolean;
};

export const PageTransitionLayerContext =
  createContext<PageTransitionLayerContextValue | null>(null);

export const PAGE_TRANSITION_LAYER_CONTEXT_VALUES: Record<LayerStatus, PageTransitionLayerContextValue> = {
  current: { status: 'current', isCurrentLayer: true },
  stacked: { status: 'stacked', isCurrentLayer: false },
  exiting: { status: 'exiting', isCurrentLayer: false },
};

export function usePageTransitionLayer() {
  return useContext(PageTransitionLayerContext);
}
