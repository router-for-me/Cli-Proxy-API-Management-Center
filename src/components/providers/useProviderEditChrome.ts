import { useEffect } from 'react';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';

// useProviderEditChrome wires the swipe-back ref and Escape-key handler
// shared by every AiProvidersXxxEditPage (Phase D code-quality dedup).
// Returns the ref to attach to the SecondaryScreenShell wrapper.
export function useProviderEditChrome(onBack: () => void) {
  const swipeRef = useEdgeSwipeBack({ onBack });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);
  return swipeRef;
}
